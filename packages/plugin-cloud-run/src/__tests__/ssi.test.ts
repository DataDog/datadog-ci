import type {InstrumentServiceConfigOptions} from '../service-config'
import type {IContainer, IEnvVar, IService} from '../types'
import type {Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {DD_TRACE_ENABLED_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  LIBCS,
  getLanguageCompatibilityErrors,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {instrumentServiceConfig} from '../service-config'
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
    (libc) => getLanguageCompatibilityErrors({language, libc, version: defaultOptions.tracerVersion}).length === 0
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
      tracing,
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

const serviceConfigOptions = (language: Language | 'none' = 'nodejs'): InstrumentServiceConfigOptions => ({
  ssiConfig: resolveSsiConfig({
    ...defaultOptions,
    tracing: language === 'none' ? undefined : 'inject',
    language: language === 'none' ? undefined : language,
  }),
  ddService: 'service',
  environment: undefined,
  version: undefined,
  envVarsByName: {
    DD_SERVICE: {name: 'DD_SERVICE', value: 'service'},
    [DD_TRACE_ENABLED_ENV_VAR]: {name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'},
  },
  healthCheckPort: undefined,
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
  test('rejects invalid configuration and reserved Agent resource names', () => {
    const service = serviceWithWorker()
    expect(() =>
      instrumentServiceConfig(service, {
        ...serviceConfigOptions(),
        ssiConfig: {kind: 'errors', errors: ['invalid SSI flags'], warnings: []},
      })
    ).toThrow('invalid SSI flags')
    expect(() =>
      instrumentServiceConfig(service, {...serviceConfigOptions(), sidecarName: 'datadog-tracer-copy'})
    ).toThrow(/reserved/)
    expect(() =>
      instrumentServiceConfig(service, {...serviceConfigOptions(), sharedVolumeName: 'datadog-tracer'})
    ).toThrow(/reserved/)
  })

  test('does not replace unowned reserved resources', () => {
    const containerService = serviceWithWorker()
    containerService.template!.containers!.push({name: 'datadog-tracer-copy'} as IContainer)
    expect(() => instrumentServiceConfig(containerService, serviceConfigOptions())).toThrow(/reserved/)

    const volumeService = serviceWithWorker()
    volumeService.template!.volumes!.push({name: 'datadog-tracer'})
    expect(() => instrumentServiceConfig(volumeService, serviceConfigOptions())).toThrow(/reserved/)
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
    expect(app?.dependsOn).toEqual(['datadog-tracer-copy', 'datadog-sidecar'])
    expect(app?.env).toContainEqual({name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'})
    expect(app?.env).toContainEqual({
      name: 'NODE_OPTIONS',
      value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js',
    })
    expect(app?.env?.find((variable) => variable.name === 'DD_TAGS')?.value).toBe(SINGLE_LANGUAGE_INJECTION_MODE_TAG)
    expect(result.labels?.dd_sls_injection_mode).toBe('single_language')
  })

  test('applies the tracer-copy sidecar and Memory volume', () => {
    const result = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const tracer = result.template?.containers?.find((container) => container.name === 'datadog-tracer-copy')

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
      'datadog-tracer-copy',
      '/datadog-lib',
      '/datadog-lib/.dd-trace-js-copy-finished',
      '18999',
    ])
    expect(tracer?.args?.[1]).toBe(
      ['set -e', '/datadog-init/copy-lib.sh "$1"', '[ -f "$2" ]', 'exec /datadog-init/probe-server "$3"'].join('\n')
    )
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toEqual({
      name: 'datadog-tracer',
      emptyDir: {medium: 1},
    })
  })

  test('tracks an adopted unnamed main container without taking over a customer name', () => {
    const unnamed = serviceWithWorker()
    unnamed.template!.containers![0].name = ''
    const adopted = instrumentServiceConfig(unnamed, serviceConfigOptions())
    expect(adopted.template?.containers?.[0].name).toBe('datadog-app')
    expect(instrumentServiceConfig(adopted, serviceConfigOptions('python')).template?.containers?.[0].name).toBe(
      'datadog-app'
    )

    const customer = serviceWithWorker()
    customer.template!.containers![0].name = 'datadog-app'
    expect(() => instrumentServiceConfig(customer, serviceConfigOptions())).toThrow(/reserved/)
    expect(customer.template?.containers?.[0].name).toBe('datadog-app')
  })

  test('replaces owned SSI without removing unrelated container configuration', () => {
    const node = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const app = node.template!.containers![0]
    const worker = node.template!.containers![1]
    app.dependsOn = ['datadog-tracer-copy', 'datadog-sidecar']
    worker.dependsOn = ['datadog-tracer-copy', 'datadog-sidecar']
    worker.env = mergeLanguageInjectionEnv(worker.env, getSpec('nodejs'))

    const result = instrumentServiceConfig(node, serviceConfigOptions('python'))
    const updatedApp = result.template?.containers?.find((container) => container.name === 'app')
    const updatedWorker = result.template?.containers?.find((container) => container.name === 'worker')

    expect(updatedApp?.env).toContainEqual({name: 'NODE_OPTIONS', value: '--inspect'})
    expect(updatedApp?.env).toContainEqual({name: 'PYTHONPATH', value: '/datadog-lib'})
    expect(updatedApp?.dependsOn).toEqual(['datadog-tracer-copy', 'datadog-sidecar'])
    expect(updatedWorker?.env).toEqual(worker.env)
    expect(updatedWorker?.dependsOn).toEqual(['datadog-sidecar'])
    expect(result.template?.containers?.filter((container) => container.name === 'datadog-tracer-copy')).toHaveLength(1)
    expect(result.template?.containers?.find((container) => container.name === 'datadog-tracer-copy')?.image).toBe(
      'gcr.io/datadoghq/dd-lib-python-init:latest'
    )
    expect(result.template?.volumes?.filter((volume) => volume.name === 'datadog-tracer')).toHaveLength(1)
    expect(instrumentServiceConfig(result, serviceConfigOptions('python'))).toEqual(result)
  })

  test.each([
    ['directly', false],
    ['transitively', true],
  ] as const)('rejects an Agent that %s depends on the main container', (_description, transitive) => {
    const service = serviceWithWorker()
    if (transitive) {
      service.template!.containers![1].dependsOn = ['app']
    }
    service.template!.containers!.push({
      name: 'datadog-sidecar',
      dependsOn: [transitive ? 'worker' : 'app'],
    } as IContainer)

    expect(() => instrumentServiceConfig(service, serviceConfigOptions())).toThrow(SsiConfigError)
  })

  test.each([
    ['manual', 'true', false],
    ['disabled', 'false', true],
  ] as const)('removes owned SSI when tracing is %s', (tracing, traceEnabled, adoptsMainContainer) => {
    const service = serviceWithWorker()
    if (adoptsMainContainer) {
      service.template!.containers![0].name = ''
    }
    const injected = instrumentServiceConfig(service, serviceConfigOptions())
    const injectedApp = injected.template!.containers![0]
    injectedApp.volumeMounts!.push({name: 'customer-volume', mountPath: '/customer'})
    injectedApp.dependsOn!.push('database')
    injected.template!.volumes!.push({name: 'customer-volume'})
    if (adoptsMainContainer) {
      injected.template!.containers![1].dependsOn = ['datadog-app', 'database']
    }

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
    expect(result.template!.containers!.map((container) => container.name)).not.toContain('datadog-tracer-copy')
    expect(result.template!.volumes!.map((volume) => volume.name)).toEqual(
      expect.arrayContaining(['shared-volume', 'customer-volume'])
    )
    expect(result.template!.volumes!.map((volume) => volume.name)).not.toContain('datadog-tracer')
    expect(app).toMatchObject({
      name: adoptsMainContainer ? '' : 'app',
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
    expect(result.template!.containers![1].dependsOn).toEqual(adoptsMainContainer ? ['database'] : undefined)
  })

  test('omitting SSI configuration preserves owned SSI', () => {
    const injected = instrumentServiceConfig(serviceWithWorker(), serviceConfigOptions())
    const result = instrumentServiceConfig(injected, {...serviceConfigOptions('none'), ssiConfig: undefined})

    expect(result.labels?.dd_sls_injection_mode).toBe('single_language')
    expect(result.template?.containers?.find((container) => container.name === 'datadog-tracer-copy')).toBeDefined()
    expect(result.template?.volumes?.find((volume) => volume.name === 'datadog-tracer')).toBeDefined()
  })

  test('no-injection preserves unrelated containers and the requested tracing state', () => {
    const service = serviceWithWorker()
    const tracer = {name: 'datadog-tracer-copy', image: 'old-tracer', env: [{name: 'KEEP', value: 'true'}]}
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
