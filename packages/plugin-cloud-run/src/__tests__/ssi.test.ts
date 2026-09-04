import type {InstrumentServiceConfigOptions} from '../service-config'
import type {IContainer, IEnvVar, IService} from '../types'
import type {TracingInput} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import type {Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {
  DD_TRACE_ENABLED_ENV_VAR,
  DEFAULT_HEALTH_CHECK_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_READINESS_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  LIBCS,
  getLanguageCompatibilityErrors,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {TRACER_INJECTION_LANGUAGES, type Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {instrumentServiceConfig} from '../service-config'
import {
  COMPOSITE_TRACER_COMPLETION_MARKER,
  COMPOSITE_TRACER_IMAGE,
  COMPOSITE_TRACER_MOUNT_PATH,
  getTracingEnvValue,
  mergeCompositeInjectionEnv,
  mergeLanguageInjectionEnv,
  normalizeTracingMode,
  removeInjectionEnv,
  resolveSsiConfig,
  selectMainContainer,
  SsiConfigError,
  type SsiOptions,
} from '../ssi'

const defaultOptions: SsiOptions = {
  language: undefined,
  tracing: undefined,
  tracerVersion: undefined,
  tracerLibc: undefined,
  tracerVolumeMedium: undefined,
}

const getSpec = (language: Language, libc: Libc = 'glibc') =>
  getLanguageInjectionSpec({
    language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc,
    root: TRACER_MOUNT_PATH,
  })

const nodeSpec = getSpec('nodejs')
const supportedLanguageVariants = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
  LIBCS.filter((libc) => getLanguageCompatibilityErrors({language, libc, version: 'latest'}).length === 0).map(
    (libc) => [language, libc] as const
  )
)

const getErrors = (overrides: Partial<SsiOptions>) => {
  const result = resolveSsiConfig({...defaultOptions, ...overrides})

  return result.kind === 'errors' ? result.errors.join('\n') : ''
}

describe('tracing modes', () => {
  test.each<[TracingInput | undefined, SsiOptions['tracing'], string | undefined]>([
    [undefined, undefined, undefined],
    ['true', 'manual', 'true'],
    ['1', 'manual', '1'],
    ['manual', 'manual', 'true'],
    ['false', 'disabled', 'false'],
    ['0', 'disabled', '0'],
    ['disabled', 'disabled', 'false'],
    ['inject', 'inject', 'true'],
  ])('normalizes %s', (input, mode, envValue) => {
    expect(normalizeTracingMode(input)).toBe(mode)
    expect(getTracingEnvValue(input)).toBe(envValue)
  })
})

describe('resolveSsiConfig', () => {
  test.each<[string, SsiOptions['tracing']]>([
    ['unset', undefined],
    ['manual', 'manual'],
    ['disabled', 'disabled'],
  ])('does not inject when tracing is %s', (_description, tracing) => {
    expect(resolveSsiConfig({...defaultOptions, tracing, language: 'nodejs'})).toEqual({
      kind: 'no-injection',
      tracing,
      warnings: [],
    })
  })

  test('requires injection for tracer options, including explicit defaults', () => {
    expect(getErrors({tracerVersion: 'latest', tracerLibc: 'glibc', tracerVolumeMedium: 'memory'})).toContain(
      '--tracer-version, --tracer-libc, --tracer-volume-medium'
    )
  })

  test.each([
    ['nodejs', 'single-language'],
    [undefined, 'multi-language'],
  ] as const)('defaults %s injection to memory and accepts disk', (language, kind) => {
    const memory = resolveSsiConfig({...defaultOptions, tracing: 'inject', language})
    const disk = resolveSsiConfig({...defaultOptions, tracing: 'inject', language, tracerVolumeMedium: 'disk'})

    expect(memory).toMatchObject({kind, tracerVolumeMedium: 'memory'})
    expect(disk).toMatchObject({kind, tracerVolumeMedium: 'disk'})
  })

  test.each([
    [{tracing: 'inject', tracerVersion: 'latest'}, '--tracer-version'],
    [{tracing: 'inject', tracerLibc: 'glibc'}, '--tracer-libc'],
    [{tracing: 'inject', language: 'go'}, '--tracing manual'],
    [{tracing: 'inject', language: 'ruby', tracerLibc: 'musl'}, 'musl'],
    [{tracing: 'inject', language: 'csharp', tracerVersion: '2.51.0'}, 'Use tracer version 3.0'],
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

  test('merges and removes multi-language activation while preserving compatible preload entries', () => {
    const existing: IEnvVar[] = [{name: 'LD_PRELOAD', value: '/customer/preload.so'}]
    const injected = mergeCompositeInjectionEnv(existing)

    expect(injected).toEqual([
      {
        name: 'LD_PRELOAD',
        value: '/opt/datadog-packages/datadog-apm-inject/stable/inject/launcher.preload.so /customer/preload.so',
      },
      {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'},
    ])
    expect(mergeCompositeInjectionEnv(injected)).toEqual(injected)
    expect(removeInjectionEnv(injected)).toEqual(existing)
  })

  test.each(['LD_PRELOAD', 'DD_INJECT_SENDER_TYPE'])('rejects duplicate multi-language %s values', (name) => {
    expect(() =>
      mergeCompositeInjectionEnv([
        {name, value: 'first'},
        {name, value: 'second'},
      ])
    ).toThrow(/more than once/)
  })

  test.each(['LD_PRELOAD', 'DD_INJECT_SENDER_TYPE'])('rejects a secret-backed multi-language %s value', (name) => {
    expect(() => mergeCompositeInjectionEnv([{name, valueSource: {secretKeyRef: {secret: 'secret'}}}])).toThrow(
      SsiConfigError
    )
  })

  test('rejects a conflicting injection sender', () => {
    expect(() => mergeCompositeInjectionEnv([{name: 'DD_INJECT_SENDER_TYPE', value: 'customer'}])).toThrow(
      /DD_INJECT_SENDER_TYPE is already set/
    )
  })

  test('reports a conflicting scalar value', () => {
    expect(() =>
      mergeLanguageInjectionEnv([{name: 'CORECLR_ENABLE_PROFILING', value: '0'}], getSpec('csharp'))
    ).toThrow(/CORECLR_ENABLE_PROFILING is already set to "0"; expected "1"/)
  })

  test.each(supportedLanguageVariants)('removes the %s/%s tracer environment', (language, libc) => {
    const injected = mergeLanguageInjectionEnv(
      [
        {name: 'CUSTOM', value: 'keep'},
        {name: 'DD_TAGS', value: 'team:backend'},
      ],
      getSpec(language, libc)
    )

    expect(removeInjectionEnv(injected)).toEqual([
      {name: 'CUSTOM', value: 'keep'},
      {name: 'DD_TAGS', value: 'team:backend'},
    ])
  })

  test('replaces another language when the injection tag is missing', () => {
    const markerlessJava = mergeLanguageInjectionEnv([{name: 'CUSTOM', value: 'keep'}], getSpec('java')).filter(
      (variable) => variable.name !== 'DD_TAGS'
    )
    const replaced = mergeLanguageInjectionEnv(removeInjectionEnv(markerlessJava), nodeSpec)

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

    expect(removeInjectionEnv(env)).toEqual(env)
  })

  test('removes both known PHP libc paths while preserving other scan directories', () => {
    const glibc = getSpec('php', 'glibc').env[0].value
    const musl = getSpec('php', 'musl').env[0].value
    expect(removeInjectionEnv([{name: 'PHP_INI_SCAN_DIR', value: `/etc/php:${glibc}:${musl}:/custom/php`}])).toEqual([
      {name: 'PHP_INI_SCAN_DIR', value: '/etc/php:/custom/php'},
    ])
  })
})

describe('selectMainContainer', () => {
  const reserved = new Set(['datadog-sidecar', 'datadog-tracer'])

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

  test('explains how to resolve missing and ambiguous main containers', () => {
    expect(() => selectMainContainer([{name: 'datadog-sidecar'}], reserved)).toThrow(/Add an application container/)
    expect(() =>
      selectMainContainer(
        [
          {name: 'app', ports: [{containerPort: 8080}]},
          {name: 'admin', ports: [{containerPort: 9090}]},
        ],
        reserved
      )
    ).toThrow(/app, admin.*only the main application container with a port/)
    expect(() => selectMainContainer([{name: 'app'}, {name: 'worker'}], reserved)).toThrow(
      /app, worker.*Declare a port on the main application container/
    )
  })
})

const serviceConfigOptions = (
  language: Language | 'multi' | 'none' = 'nodejs',
  tracerVolumeMedium: SsiOptions['tracerVolumeMedium'] = undefined
): InstrumentServiceConfigOptions => ({
  ssiConfig: resolveSsiConfig({
    ...defaultOptions,
    tracing: language === 'none' ? undefined : 'inject',
    language: language === 'none' || language === 'multi' ? undefined : language,
    tracerVolumeMedium,
  }),
  ddService: 'service',
  environment: undefined,
  version: undefined,
  envVarsByName: {
    DD_SERVICE: {name: 'DD_SERVICE', value: 'service'},
    [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'},
  },
  healthCheckPort: undefined,
  tracerReadinessPort: TRACER_READINESS_PORT,
  sidecarName: 'datadog-sidecar',
  sidecarImage: 'agent:latest',
  sidecarCpus: '1',
  sidecarMemory: '512Mi',
  sharedVolumeName: 'shared-volume',
  sharedVolumePath: '/shared-volume',
})

const serviceWithWorker = (): IService =>
  ({
    template: {
      containers: [
        {
          name: 'app',
          ports: [{containerPort: 8080}],
          env: [{name: 'NODE_OPTIONS', value: '--inspect'}],
          volumeMounts: [],
        },
        {name: 'worker', env: [{name: 'WORKER', value: 'true'}], volumeMounts: []},
      ],
      volumes: [],
      revision: 'service-1',
    },
  }) as IService

describe('SSI service preparation', () => {
  test('rejects invalid configuration', () => {
    expect(() =>
      instrumentServiceConfig(serviceWithWorker(), {
        ...serviceConfigOptions(),
        ssiConfig: {kind: 'errors', errors: ['invalid SSI flags'], warnings: []},
      })
    ).toThrow('invalid SSI flags')
  })

  test('applies Agent and language environment only to the main container', () => {
    const service = serviceWithWorker()
    const worker = service.template?.containers?.[1]
    const result = instrumentServiceConfig(service, serviceConfigOptions())
    const app = result.template?.containers?.find((container) => container.name === 'app')

    expect(result.template?.containers?.find((container) => container.name === 'worker')).toEqual(worker)
    expect(app?.volumeMounts).toEqual([
      {name: 'shared-volume', mountPath: '/shared-volume'},
      {name: 'datadog-tracer', mountPath: '/datadog-lib'},
    ])
    expect(app?.dependsOn).toEqual(['datadog-tracer', 'datadog-sidecar'])
    expect(app?.env).toContainEqual({name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'})
    expect(app?.env).toContainEqual({
      name: 'NODE_OPTIONS',
      value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js',
    })
    expect(app?.env?.find((variable) => variable.name === 'DD_TAGS')?.value).toBe(SINGLE_LANGUAGE_INJECTION_MODE_TAG)
    expect(result.labels?.dd_sls_injection_mode).toBe('single_language')
  })

  test('preserves existing Node configuration when injecting Python', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions('python'))
    const app = result.template?.containers?.find((container) => container.name === 'app')

    expect(app?.env).toContainEqual({name: 'NODE_OPTIONS', value: '--inspect'})
    expect(app?.env).toContainEqual({name: 'PYTHONPATH', value: '/datadog-lib'})
  })

  test('applies the tracer container and sized Memory volume', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const tracer = result.template?.containers?.find((container) => container.name === 'datadog-tracer')

    expect(tracer).toMatchObject({
      image: 'gcr.io/datadoghq/dd-lib-js-init:latest',
      command: ['/bin/sh'],
      volumeMounts: [{name: 'datadog-tracer', mountPath: '/datadog-lib'}],
      startupProbe: {
        tcpSocket: {port: 18999},
        initialDelaySeconds: 0,
        periodSeconds: 5,
        failureThreshold: 48,
        timeoutSeconds: 1,
      },
    })
    expect(tracer?.args?.slice(2)).toEqual([
      'datadog-tracer',
      '/datadog-lib',
      '/datadog-lib/.dd-trace-js-copy-finished',
      '18999',
    ])
    expect(tracer?.args?.[1]).toBe(
      ['set -e', '/datadog-init/copy-lib.sh "$1"', '[ -f "$2" ]', 'exec /datadog-init/probe-server "$3"'].join('\n')
    )
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toEqual({
      name: 'datadog-tracer',
      emptyDir: {medium: 1, sizeLimit: '500Mi'},
    })
  })

  test('applies multi-language activation and the composite memory lifecycle', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions('multi'))
    const app = result.template?.containers?.find((container) => container.name === 'app')
    const tracer = result.template?.containers?.find((container) => container.name === TRACER_CONTAINER_NAME)

    expect(app?.env).toEqual(
      expect.arrayContaining([
        {
          name: 'LD_PRELOAD',
          value: `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so`,
        },
        {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'},
      ])
    )
    expect(app?.volumeMounts).toContainEqual({name: TRACER_CONTAINER_NAME, mountPath: COMPOSITE_TRACER_MOUNT_PATH})
    expect(app?.dependsOn).toEqual([TRACER_CONTAINER_NAME, 'datadog-sidecar'])
    expect(tracer).toMatchObject({
      image: COMPOSITE_TRACER_IMAGE,
      volumeMounts: [{name: TRACER_CONTAINER_NAME, mountPath: COMPOSITE_TRACER_MOUNT_PATH}],
      resources: {limits: {memory: '2Gi'}},
    })
    expect(tracer?.args?.slice(2)).toEqual([
      TRACER_CONTAINER_NAME,
      COMPOSITE_TRACER_MOUNT_PATH,
      COMPOSITE_TRACER_COMPLETION_MARKER,
      String(TRACER_READINESS_PORT),
    ])
    expect(result.template?.volumes?.find((volume) => volume.name === TRACER_CONTAINER_NAME)).toEqual({
      name: TRACER_CONTAINER_NAME,
      emptyDir: {medium: 1, sizeLimit: '1.5Gi'},
    })
    expect(result.labels?.dd_sls_injection_mode).toBe('multi_language')
  })

  test('uses disk for multi-language injection without a tracer memory limit', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions('multi', 'disk'))
    const tracer = result.template?.containers?.find((container) => container.name === TRACER_CONTAINER_NAME)

    expect(tracer?.resources).toBeUndefined()
    expect(result.template?.volumes?.find((volume) => volume.name === TRACER_CONTAINER_NAME)).toEqual({
      name: TRACER_CONTAINER_NAME,
      emptyDir: {medium: 2, sizeLimit: '10Gi'},
    })
    expect(result.launchStage).toBe('BETA')
    expect(result.template?.executionEnvironment).toBe(2)
  })

  test.each([
    [undefined, 'BETA'],
    ['LAUNCH_STAGE_UNSPECIFIED', 'BETA'],
    ['GA', 'BETA'],
    ['BETA', 'BETA'],
    ['ALPHA', 'ALPHA'],
  ] as const)('uses a 10 GiB disk volume and launch stage %s', (launchStage, expectedLaunchStage) => {
    const service = serviceWithWorker()
    service.description = 'keep me'
    service.launchStage = launchStage
    service.template!.executionEnvironment = 1
    service.template!.serviceAccount = 'customer-service-account'

    const result = instrumentServiceConfig(service, serviceConfigOptions('nodejs', 'disk'))

    expect(result.launchStage).toBe(expectedLaunchStage)
    expect(result.description).toBe('keep me')
    expect(result.template).toMatchObject({
      executionEnvironment: 2,
      serviceAccount: 'customer-service-account',
    })
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toEqual({
      name: 'datadog-tracer',
      emptyDir: {medium: 2, sizeLimit: '10Gi'},
    })
  })

  test('switches tracer storage without resetting disk requirements', () => {
    const memory = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const disk = instrumentServiceConfig(memory, serviceConfigOptions('nodejs', 'disk'))
    const retry = instrumentServiceConfig(disk, serviceConfigOptions('nodejs', 'disk'))
    const memoryAgain = instrumentServiceConfig(disk, serviceConfigOptions())

    expect(disk.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toMatchObject({
      emptyDir: {medium: 2, sizeLimit: '10Gi'},
    })
    expect(retry).toEqual(disk)
    expect(memoryAgain.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toMatchObject({
      emptyDir: {medium: 1, sizeLimit: '500Mi'},
    })
    expect(memoryAgain.launchStage).toBe('BETA')
    expect(memoryAgain.template?.executionEnvironment).toBe(2)
  })

  test.each([
    ['manual', 'true'],
    ['disabled', 'false'],
  ] as const)('removes disk injection for %s without resetting service requirements', (tracing, traceEnabled) => {
    const injected = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions('nodejs', 'disk'))
    const noInjectionOptions = serviceConfigOptions('none')
    const result = instrumentServiceConfig(injected, {
      ...noInjectionOptions,
      ssiConfig: resolveSsiConfig({...defaultOptions, tracing, language: 'nodejs'}),
      envVarsByName: {
        ...noInjectionOptions.envVarsByName,
        [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: traceEnabled},
      },
    })

    expect(result.template?.containers?.find((container) => container.name === 'datadog-tracer')).toBeUndefined()
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toBeUndefined()
    expect(result.launchStage).toBe('BETA')
    expect(result.template?.executionEnvironment).toBe(2)
  })

  test('switches between single- and multi-language injection idempotently', () => {
    const single = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const multi = instrumentServiceConfig(single, serviceConfigOptions('multi'))
    const singleAgain = instrumentServiceConfig(multi, serviceConfigOptions('python'))

    expect(multi.labels?.dd_sls_injection_mode).toBe('multi_language')
    expect(multi.template?.containers?.find(({name}) => name === 'app')?.env).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({name: 'NODE_OPTIONS', value: expect.stringContaining('/datadog-lib')}),
      ])
    )
    expect(instrumentServiceConfig(multi, serviceConfigOptions('multi'))).toEqual(multi)
    expect(singleAgain.labels?.dd_sls_injection_mode).toBe('single_language')
    expect(singleAgain.template?.containers?.find(({name}) => name === 'app')?.env).toEqual(
      expect.arrayContaining([expect.objectContaining({name: 'PYTHONPATH', value: '/datadog-lib'})])
    )
    expect(singleAgain.template?.containers?.find(({name}) => name === 'app')?.env).not.toEqual(
      expect.arrayContaining([expect.objectContaining({name: 'DD_INJECT_SENDER_TYPE'})])
    )
  })

  test.each([
    ['single-language', 'NODE_OPTIONS', serviceConfigOptions()],
    ['multi-language', 'LD_PRELOAD', serviceConfigOptions('multi')],
  ] satisfies [string, string, InstrumentServiceConfigOptions][])(
    'rejects duplicate %s environment values before Agent environment normalization',
    (_mode, name, options) => {
      const service = serviceWithWorker()
      service.template!.containers![0].env = [
        {name, value: 'first'},
        {name, value: 'second'},
      ]

      expect(() => instrumentServiceConfig(service, options)).toThrow(/more than once/)
    }
  )

  test('uses the configured readiness port for the tracer container', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), {
      ...serviceConfigOptions(),
      tracerReadinessPort: 19000,
    })
    const tracer = result.template?.containers?.find((container) => container.name === 'datadog-tracer')

    expect(tracer?.args?.at(-1)).toBe('19000')
    expect(tracer?.startupProbe?.tcpSocket?.port).toBe(19000)
  })

  test('rejects a readiness port collision with the main application container', () => {
    expect(() =>
      instrumentServiceConfig(serviceWithWorker(), {
        ...serviceConfigOptions(),
        tracerReadinessPort: 8080,
      })
    ).toThrow(/--tracer-readiness-port.*container 'app'.*--tracer-readiness-port or container 'app' port/)
  })

  test('names an unnamed container in readiness port collision errors', () => {
    const service = serviceWithWorker()
    service.template!.containers![0].name = ''

    expect(() => instrumentServiceConfig(service, {...serviceConfigOptions(), tracerReadinessPort: 8080})).toThrow(
      /container '<unnamed>'/
    )
  })

  test('rejects a readiness port collision with the default Agent health port', () => {
    expect(() =>
      instrumentServiceConfig(serviceWithWorker(), {
        ...serviceConfigOptions(),
        tracerReadinessPort: DEFAULT_HEALTH_CHECK_PORT,
      })
    ).toThrow(new RegExp(`Datadog Agent health port ${DEFAULT_HEALTH_CHECK_PORT}`))
  })

  test('rejects a readiness port collision with an explicit Agent health port', () => {
    expect(() =>
      instrumentServiceConfig(serviceWithWorker(), {
        ...serviceConfigOptions(),
        healthCheckPort: TRACER_READINESS_PORT,
      })
    ).toThrow(/Datadog Agent health port 18999.*--tracer-readiness-port or --health-check-port/)
  })

  test('rejects a readiness port collision with the existing Agent DD_HEALTH_PORT', () => {
    const service = serviceWithWorker()
    service.template!.containers!.push({
      name: 'datadog-sidecar',
      env: [{name: 'DD_HEALTH_PORT', value: String(TRACER_READINESS_PORT)}],
    } as IContainer)

    expect(() => instrumentServiceConfig(service, serviceConfigOptions())).toThrow(
      /Datadog Agent health port 18999.*container 'datadog-sidecar'/
    )
  })

  test('uses an explicit health port for the Agent environment and startup probe', () => {
    const service = serviceWithWorker()
    service.template!.containers!.push({
      name: 'datadog-sidecar',
      env: [{name: 'DD_HEALTH_PORT', value: '8128'}],
    } as IContainer)

    const result = instrumentServiceConfig(service, {...serviceConfigOptions(), healthCheckPort: 8127})
    const sidecar = result.template?.containers?.find((container) => container.name === 'datadog-sidecar')

    expect(sidecar?.startupProbe?.tcpSocket?.port).toBe(8127)
    expect(sidecar?.env).toContainEqual({name: 'DD_HEALTH_PORT', value: '8127'})
  })

  test('uses the existing Agent DD_HEALTH_PORT when there is no explicit port', () => {
    const service = serviceWithWorker()
    service.template!.containers!.push({
      name: 'datadog-sidecar',
      env: [{name: 'DD_HEALTH_PORT', value: '8127'}],
    } as IContainer)

    const result = instrumentServiceConfig(service, serviceConfigOptions())
    const sidecar = result.template?.containers?.find((container) => container.name === 'datadog-sidecar')

    expect(sidecar?.startupProbe?.tcpSocket?.port).toBe(8127)
    expect(sidecar?.env).toContainEqual({name: 'DD_HEALTH_PORT', value: '8127'})
  })

  test('uses the default Agent health port when no port is configured', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const sidecar = result.template?.containers?.find((container) => container.name === 'datadog-sidecar')

    expect(sidecar?.startupProbe?.tcpSocket?.port).toBe(DEFAULT_HEALTH_CHECK_PORT)
    expect(sidecar?.env).toContainEqual({name: 'DD_HEALTH_PORT', value: String(DEFAULT_HEALTH_CHECK_PORT)})
  })

  test('keeps an unnamed main container unnamed during injection and replacement', () => {
    const service = serviceWithWorker()
    service.template!.containers![0].name = ''

    const injected = instrumentServiceConfig(service, serviceConfigOptions())
    expect(injected.template?.containers?.[0].name).toBe('')
    expect(instrumentServiceConfig(injected, serviceConfigOptions('python')).template?.containers?.[0].name).toBe('')
  })

  test('replaces owned SSI without removing unrelated container configuration', () => {
    const node = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const app = node.template!.containers![0]
    const worker = node.template!.containers![1]
    app.dependsOn = ['datadog-tracer', 'datadog-sidecar']
    worker.dependsOn = ['datadog-tracer', 'datadog-sidecar']
    worker.env = mergeLanguageInjectionEnv(worker.env, getSpec('nodejs'))

    const result = instrumentServiceConfig(node, serviceConfigOptions('python'))
    const updatedApp = result.template?.containers?.find((container) => container.name === 'app')
    const updatedWorker = result.template?.containers?.find((container) => container.name === 'worker')

    expect(updatedApp?.env).toContainEqual({name: 'NODE_OPTIONS', value: '--inspect'})
    expect(updatedApp?.env).toContainEqual({name: 'PYTHONPATH', value: '/datadog-lib'})
    expect(updatedApp?.dependsOn).toEqual(['datadog-tracer', 'datadog-sidecar'])
    expect(updatedWorker?.env).toEqual(worker.env)
    expect(updatedWorker?.dependsOn).toEqual(['datadog-sidecar'])
    expect(result.template?.containers?.filter((container) => container.name === 'datadog-tracer')).toHaveLength(1)
    expect(result.template?.containers?.find((container) => container.name === 'datadog-tracer')?.image).toBe(
      'gcr.io/datadoghq/dd-lib-python-init:latest'
    )
    expect(result.template?.volumes?.filter((volume) => volume.name === 'datadog-tracer')).toHaveLength(1)
    expect(instrumentServiceConfig(result, serviceConfigOptions('python'))).toEqual(result)
  })

  test('rejects an unowned tracer container', () => {
    const service = serviceWithWorker()
    service.template!.containers!.push({name: TRACER_CONTAINER_NAME, image: 'customer-image'} as IContainer)

    expect(() => instrumentServiceConfig(service, serviceConfigOptions('python'))).toThrow(
      "the service already has a container named 'datadog-tracer' that is not managed by datadog-ci"
    )
  })

  test.each([
    ['manual', 'true'],
    ['disabled', 'false'],
  ] as const)('removes owned SSI when tracing is %s', (tracing, traceEnabled) => {
    const service = serviceWithWorker()
    service.template!.containers![0].name = ''
    const injected = instrumentServiceConfig(service, serviceConfigOptions())
    const injectedApp = injected.template!.containers![0]
    injectedApp.volumeMounts!.push({name: 'customer-volume', mountPath: '/customer'})
    injectedApp.dependsOn!.push('database')
    injected.template!.volumes!.push({name: 'customer-volume'})
    const noInjectionOptions = serviceConfigOptions('none')
    const result = instrumentServiceConfig(injected, {
      ...noInjectionOptions,
      ssiConfig: resolveSsiConfig({...defaultOptions, tracing, language: 'nodejs'}),
      envVarsByName: {
        ...noInjectionOptions.envVarsByName,
        [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: traceEnabled},
      },
    })
    const app = result.template!.containers![0]

    expect(result.labels).not.toHaveProperty('dd_sls_injection_mode')
    expect(result.template!.containers!.map((container) => container.name)).not.toContain('datadog-tracer')
    expect(result.template!.volumes!.map((volume) => volume.name)).toEqual(
      expect.arrayContaining(['shared-volume', 'customer-volume'])
    )
    expect(result.template!.volumes!.map((volume) => volume.name)).not.toContain('datadog-tracer')
    expect(app).toMatchObject({
      name: '',
      env: expect.arrayContaining([
        {name: 'NODE_OPTIONS', value: '--inspect'},
        {name: DD_TRACE_ENABLED_ENV_VAR, value: traceEnabled},
      ]),
      volumeMounts: expect.arrayContaining([
        {name: 'shared-volume', mountPath: '/shared-volume'},
        {name: 'customer-volume', mountPath: '/customer'},
      ]),
      dependsOn: ['datadog-sidecar', 'database'],
    })
    expect(app.env?.find((variable) => variable.name === 'DD_TAGS')).toBeUndefined()
    expect(app.volumeMounts?.map((mount) => mount.name)).not.toContain('datadog-tracer')
    expect(result.template!.containers![1].dependsOn).toBeUndefined()
  })

  test('manual tracing removes drifted multi-language state and preserves single-language fragments', () => {
    const service = serviceWithWorker()
    service.template!.containers![0].env = [
      {name: 'NODE_OPTIONS', value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js'},
    ]
    const injected = instrumentServiceConfig(service, serviceConfigOptions('multi'))
    const injectedApp = injected.template!.containers!.find(({name}) => name === 'app')!
    injectedApp.volumeMounts = injectedApp.volumeMounts?.filter(({name}) => name !== TRACER_CONTAINER_NAME)
    const options = serviceConfigOptions('none')
    const result = instrumentServiceConfig(injected, {
      ...options,
      ssiConfig: resolveSsiConfig({...defaultOptions, tracing: 'manual'}),
      envVarsByName: {
        ...options.envVarsByName,
        [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
      },
    })
    const app = result.template?.containers?.find(({name}) => name === 'app')

    expect(result.labels).not.toHaveProperty('dd_sls_injection_mode')
    expect(result.template?.containers?.find(({name}) => name === TRACER_CONTAINER_NAME)).toBeUndefined()
    expect(app?.env).toContainEqual({
      name: 'NODE_OPTIONS',
      value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js',
    })
    expect(app?.env?.find(({name}) => name === 'LD_PRELOAD')).toBeUndefined()
    expect(app?.env?.find(({name}) => name === 'DD_INJECT_SENDER_TYPE')).toBeUndefined()
  })

  test('single-language cleanup preserves multi-language sender configuration', () => {
    const service = serviceWithWorker()
    service.template!.containers![0].env!.push({name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'})
    const injected = instrumentServiceConfig(service, serviceConfigOptions())
    const options = serviceConfigOptions('none')
    const result = instrumentServiceConfig(injected, {
      ...options,
      ssiConfig: resolveSsiConfig({...defaultOptions, tracing: 'disabled'}),
      envVarsByName: {
        ...options.envVarsByName,
        [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'},
      },
    })

    expect(result.template?.containers?.find(({name}) => name === 'app')?.env).toContainEqual({
      name: 'DD_INJECT_SENDER_TYPE',
      value: 'serverless',
    })
  })

  test('omitting SSI configuration preserves owned SSI', () => {
    const injected = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const result = instrumentServiceConfig(injected, {...serviceConfigOptions('none'), ssiConfig: undefined})

    expect(result.labels?.dd_sls_injection_mode).toBe('single_language')
    expect(result.template?.containers?.find((container) => container.name === 'datadog-tracer')).toBeDefined()
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toBeDefined()
  })

  test('unset tracing preserves an existing DD_TRACE_ENABLED value', () => {
    const service = serviceWithWorker()
    service.template!.containers![0].env!.push({name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'})
    const options = serviceConfigOptions('none')
    const {[DD_TRACE_ENABLED_ENV_VAR]: _tracing, ...envVarsByName} = options.envVarsByName
    const result = instrumentServiceConfig(service, {...options, envVarsByName})

    expect(result.template?.containers?.[0].env).toContainEqual({
      name: DD_TRACE_ENABLED_ENV_VAR,
      value: 'false',
    })
    expect(result.template?.containers?.[1].env).toContainEqual({
      name: DD_TRACE_ENABLED_ENV_VAR,
      value: 'true',
    })
  })

  test('no-injection preserves unrelated containers and the requested tracing state', () => {
    const service = serviceWithWorker()
    const tracer = {name: 'datadog-tracer', image: 'old-tracer', env: [{name: 'KEEP', value: 'true'}]}
    service.template!.containers!.push(tracer)

    const result = instrumentServiceConfig(service, serviceConfigOptions('none'))
    expect(result.template?.containers?.find((container) => container.name === tracer.name)).toEqual(tracer)
    expect(result.template?.containers?.find((container) => container.name === 'app')?.env).toContainEqual({
      name: DD_TRACE_ENABLED_ENV_VAR,
      value: 'false',
    })
    expect(result.template?.containers?.find((container) => container.name === 'worker')?.env).toContainEqual({
      name: 'DD_SERVICE',
      value: 'service',
    })
  })
})
