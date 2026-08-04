import type {IContainer, IEnvVar} from '../types'
import type {Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  LIBCS,
  getLanguageCompatibilityError,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {
  TRACER_INJECTION_LANGUAGES,
  mergeLanguageInjectionEnv,
  removeLanguageInjectionEnv,
  resolveSsiConfig,
  selectMainContainer,
  SsiConfigError,
  type SsiOptions,
} from '../ssi'

const defaultOptions: SsiOptions = {
  language: undefined,
  tracing: undefined,
  tracerVersion: 'latest',
  tracerRegistry: 'gcr.io/datadoghq',
  tracerLibc: 'glibc',
}

const getSpec = (language: Language, libc: Libc = defaultOptions.tracerLibc) =>
  getLanguageInjectionSpec({
    language,
    registry: defaultOptions.tracerRegistry,
    version: defaultOptions.tracerVersion,
    libc,
    root: TRACER_MOUNT_PATH,
  })

const nodeSpec = getSpec('nodejs')
const supportedLanguageVariants = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
  LIBCS.filter(
    (libc) => getLanguageCompatibilityError({language, libc, version: defaultOptions.tracerVersion}) === undefined
  ).map((libc) => [language, libc] as const)
)

const getErrors = (overrides: Partial<SsiOptions>) => {
  const result = resolveSsiConfig({...defaultOptions, ...overrides})

  return result.kind === 'errors' ? result.errors.join('\n') : ''
}

describe('resolveSsiConfig', () => {
  test.each<[string, SsiOptions['tracing']]>([
    ['unset', undefined],
    ['manual', 'manual'],
    ['disabled', 'disabled'],
  ])('does not inject when tracing is %s', (_description, tracing) => {
    expect(resolveSsiConfig({...defaultOptions, tracing, language: 'nodejs'})).toEqual({
      kind: 'no-injection',
      warnings: [],
    })
  })

  test('requires injection for tracer flags', () => {
    expect(getErrors({tracerVersion: '1.2.3', tracerLibc: 'musl'})).toContain('--tracer-version, --tracer-libc')
  })

  test.each([
    [{tracing: 'inject'}, '--language'],
    [{tracing: 'inject', language: 'go'}, 'dd-trace-go'],
    [{tracing: 'inject', language: 'ruby', tracerLibc: 'musl'}, 'musl'],
    [{tracing: 'inject', language: 'csharp', tracerVersion: '2.51.0'}, '2.51.0'],
  ] satisfies [Partial<SsiOptions>, string][])('rejects incompatible options %#', (options, message) => {
    expect(getErrors(options)).toContain(message)
  })

  test.each<[Language, string]>([
    ['java', 'java'],
    ['nodejs', 'js'],
    ['csharp', 'dotnet'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
  ])('resolves the %s tracer image', (language, tracerLanguage) => {
    const result = resolveSsiConfig({...defaultOptions, tracing: 'inject', language})
    expect(result.kind).toBe('single-language')
    expect(result.kind === 'single-language' && result.spec.image).toBe(
      `gcr.io/datadoghq/dd-lib-${tracerLanguage}-init:latest`
    )
  })

  test('emits the Java warning', () => {
    expect(resolveSsiConfig({...defaultOptions, tracing: 'inject', language: 'java'}).warnings.join('\n')).toContain(
      'Java 24+'
    )
  })
})

describe('language injection environment', () => {
  test('extends existing values and adds the injection tag once', () => {
    const existing: IEnvVar[] = [
      {name: 'NODE_OPTIONS', value: '--max-old-space-size=512'},
      {name: 'DD_TAGS', value: 'team:backend'},
    ]

    const first = mergeLanguageInjectionEnv(existing, nodeSpec)
    expect(first).toEqual([
      {name: 'NODE_OPTIONS', value: '--max-old-space-size=512 --require /datadog-lib/node_modules/dd-trace/init.js'},
      {name: 'DD_TAGS', value: `${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:backend`},
    ])
    expect(mergeLanguageInjectionEnv(first, nodeSpec)).toEqual(first)
  })

  test.each(['NODE_OPTIONS', 'DD_TAGS'])('rejects a value-source target for %s', (name) => {
    expect(() =>
      mergeLanguageInjectionEnv([{name, valueSource: {secretKeyRef: {secret: 'secret'}}}], nodeSpec)
    ).toThrow(SsiConfigError)
  })

  test.each(['NODE_OPTIONS', 'DD_TAGS'])('rejects a duplicate target for %s', (name) => {
    expect(() =>
      mergeLanguageInjectionEnv(
        [
          {name, value: 'first'},
          {name, value: 'second'},
        ],
        nodeSpec
      )
    ).toThrow(/more than once/)
  })

  test('rejects a conflicting scalar value', () => {
    expect(() =>
      mergeLanguageInjectionEnv([{name: 'CORECLR_ENABLE_PROFILING', value: '0'}], getSpec('csharp'))
    ).toThrow(SsiConfigError)
  })

  test.each(supportedLanguageVariants)('removes the %s/%s tracer environment', (language, libc) => {
    const injected = mergeLanguageInjectionEnv(
      [
        {name: 'CUSTOM', value: 'keep'},
        {name: 'DD_TAGS', value: 'team:backend'},
      ],
      getSpec(language, libc)
    )

    expect(removeLanguageInjectionEnv(injected)).toEqual([
      {name: 'CUSTOM', value: 'keep'},
      {name: 'DD_TAGS', value: 'team:backend'},
    ])
  })

  test('replaces another language when the injection tag is missing', () => {
    const markerlessJava = mergeLanguageInjectionEnv([{name: 'CUSTOM', value: 'keep'}], getSpec('java')).filter(
      (variable) => variable.name !== 'DD_TAGS'
    )
    const replaced = mergeLanguageInjectionEnv(removeLanguageInjectionEnv(markerlessJava), nodeSpec)

    expect(replaced).toEqual([
      {name: 'CUSTOM', value: 'keep'},
      {name: 'NODE_OPTIONS', value: '--require /datadog-lib/node_modules/dd-trace/init.js'},
      {name: 'DD_TAGS', value: SINGLE_LANGUAGE_INJECTION_MODE_TAG},
    ])
  })

  test('preserves value-source and empty environment variables during removal', () => {
    const env: IEnvVar[] = [
      {name: 'NODE_OPTIONS', valueSource: {secretKeyRef: {secret: 'node-options'}}},
      {name: 'DD_TAGS', value: ''},
    ]

    expect(removeLanguageInjectionEnv(env)).toEqual(env)
  })

  test('removes both known PHP libc paths while preserving other scan directories', () => {
    const glibc = getSpec('php', 'glibc').env[0].value
    const musl = getSpec('php', 'musl').env[0].value
    expect(
      removeLanguageInjectionEnv([{name: 'PHP_INI_SCAN_DIR', value: `/etc/php:${glibc}:${musl}:/custom/php`}])
    ).toEqual([{name: 'PHP_INI_SCAN_DIR', value: '/etc/php:/custom/php'}])
  })
})

describe('selectMainContainer', () => {
  const reserved = new Set(['datadog-sidecar', 'datadog-tracer-copy'])

  test('selects the sole application port and ignores reserved and probe ports', () => {
    const containers: IContainer[] = [
      {name: 'worker', startupProbe: {tcpSocket: {port: 9000}}},
      {name: 'app', ports: [{containerPort: 8080}]},
      {name: 'datadog-sidecar', ports: [{containerPort: 8126}]},
    ]
    expect(selectMainContainer(containers, reserved).name).toBe('app')
  })

  test('selects an unnamed main container or the sole portless candidate', () => {
    expect(selectMainContainer([{name: '', ports: [{containerPort: 8080}]}, {name: 'worker'}], reserved).name).toBe('')
    expect(selectMainContainer([{name: 'app'}, {name: 'datadog-sidecar'}], reserved).name).toBe('app')
  })

  test('rejects missing and ambiguous main containers', () => {
    expect(() => selectMainContainer([{name: 'datadog-sidecar'}], reserved)).toThrow(SsiConfigError)
    expect(() =>
      selectMainContainer(
        [
          {name: 'app', ports: [{containerPort: 8080}]},
          {name: 'admin', ports: [{containerPort: 9090}]},
        ],
        reserved
      )
    ).toThrow(/app, admin/)
    expect(() => selectMainContainer([{name: 'app'}, {name: 'worker'}], reserved)).toThrow(/app, worker/)
  })
})
