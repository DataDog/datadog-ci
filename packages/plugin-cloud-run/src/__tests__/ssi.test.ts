import type {IContainer, IEnvVar} from '../types'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import type {ServerlessLibc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {ServerlessLanguage} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {getSingleLanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {resolveSsiConfig,
  mergeNativeInjectionEnv,
  removeKnownNativeInjectionEnv, selectIngressContainer, SsiConfigError, type SsiOptions} from '../ssi'

const defaultOptions: SsiOptions = {
  language: undefined,
  tracing: undefined,
  tracerVersion: 'latest',
  tracerRegistry: 'gcr.io/datadoghq',
  tracerLibc: 'glibc',
}

const getSpec = (language: ServerlessLanguage, libc: ServerlessLibc = 'glibc') =>
  getSingleLanguageInjectionSpec({
    language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc,
    root: '/datadog-lib',
  })

const nodeSpec = getSpec('nodejs')

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

describe('native injection environment', () => {
  test('extends existing values and adds the injection tag once', () => {
    const existing: IEnvVar[] = [
      {name: 'NODE_OPTIONS', value: '--max-old-space-size=512'},
      {name: 'DD_TAGS', value: 'team:backend'},
    ]

    const first = mergeNativeInjectionEnv(existing, nodeSpec)
    expect(first).toEqual([
      {name: 'NODE_OPTIONS', value: '--max-old-space-size=512 --require /datadog-lib/node_modules/dd-trace/init.js'},
      {name: 'DD_TAGS', value: `${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:backend`},
    ])
    expect(mergeNativeInjectionEnv(first, nodeSpec)).toEqual(first)
  })

  test.each(['NODE_OPTIONS', 'DD_TAGS'])('rejects a value-source target for %s', (name) => {
    expect(() => mergeNativeInjectionEnv([{name, valueSource: {secretKeyRef: {secret: 'secret'}}}], nodeSpec)).toThrow(
      SsiValidationError
    )
  })

  test.each(['NODE_OPTIONS', 'DD_TAGS'])('rejects a duplicate target for %s', (name) => {
    expect(() =>
      mergeNativeInjectionEnv(
        [
          {name, value: 'first'},
          {name, value: 'second'},
        ],
        nodeSpec
      )
    ).toThrow(/more than once/)
  })

  test.each([
    ['java', 'glibc'],
    ['java', 'musl'],
    ['nodejs', 'glibc'],
    ['nodejs', 'musl'],
    ['csharp', 'glibc'],
    ['csharp', 'musl'],
    ['python', 'glibc'],
    ['python', 'musl'],
    ['ruby', 'glibc'],
    ['php', 'glibc'],
    ['php', 'musl'],
  ] as [ServerlessLanguage, ServerlessLibc][])('removes every exact known %s/%s fragment', (language, libc) => {
    const injected = mergeNativeInjectionEnv(
      [
        {name: 'CUSTOM', value: 'keep'},
        {name: 'DD_TAGS', value: 'team:backend'},
      ],
      getSpec(language, libc)
    )

    expect(removeKnownNativeInjectionEnv(injected)).toEqual([
      {name: 'CUSTOM', value: 'keep'},
      {name: 'DD_TAGS', value: 'team:backend'},
    ])
  })

  test('supports markerless cross-language replacement', () => {
    const markerlessJava = mergeNativeInjectionEnv([{name: 'CUSTOM', value: 'keep'}], getSpec('java')).filter(
      (variable) => variable.name !== 'DD_TAGS'
    )
    const replaced = mergeNativeInjectionEnv(removeKnownNativeInjectionEnv(markerlessJava), nodeSpec)

    expect(replaced).toEqual([
      {name: 'CUSTOM', value: 'keep'},
      {name: 'NODE_OPTIONS', value: '--require /datadog-lib/node_modules/dd-trace/init.js'},
      {name: 'DD_TAGS', value: SINGLE_LANGUAGE_INJECTION_MODE_TAG},
    ])
  })

  test('removes both known PHP libc paths while preserving other scan directories', () => {
    const glibc = getSpec('php', 'glibc').env[0].value
    const musl = getSpec('php', 'musl').env[0].value
    expect(
      removeKnownNativeInjectionEnv([{name: 'PHP_INI_SCAN_DIR', value: `/etc/php${glibc}${musl}:/custom/php`}])
    ).toEqual([{name: 'PHP_INI_SCAN_DIR', value: '/etc/php:/custom/php'}])
  })
})

describe('selectIngressContainer', () => {
  const reserved = new Set(['datadog-sidecar', 'datadog-tracer-copy'])

  test('selects the sole application port and ignores reserved and probe ports', () => {
    const containers: IContainer[] = [
      {name: 'worker', startupProbe: {tcpSocket: {port: 9000}}},
      {name: 'app', ports: [{containerPort: 8080}]},
      {name: 'datadog-sidecar', ports: [{containerPort: 8126}]},
    ]
    expect(selectIngressContainer(containers, reserved).name).toBe('app')
  })

  test('selects an unnamed ingress or the sole portless candidate', () => {
    expect(selectIngressContainer([{name: '', ports: [{containerPort: 8080}]}, {name: 'worker'}], reserved).name).toBe(
      ''
    )
    expect(selectIngressContainer([{name: 'app'}, {name: 'datadog-sidecar'}], reserved).name).toBe('app')
  })

  test('rejects missing and ambiguous ingress containers', () => {
    expect(() => selectIngressContainer([{name: 'datadog-sidecar'}], reserved)).toThrow(SsiConfigError)
    expect(() =>
      selectIngressContainer(
        [
          {name: 'app', ports: [{containerPort: 8080}]},
          {name: 'admin', ports: [{containerPort: 9090}]},
        ],
        reserved
      )
    ).toThrow(/app, admin/)
    expect(() => selectIngressContainer([{name: 'app'}, {name: 'worker'}], reserved)).toThrow(/app, worker/)
  })
})
