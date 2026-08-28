import type {ContainerApp, EnvironmentVar} from '@azure/arm-appcontainers'
import type {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {DD_TRACE_ENABLED_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {PluginCommand as InstrumentCommand} from '../commands/instrument'
import {
  SINGLE_LANGUAGE_SSI_MODE,
  SSI_INJECTION_MODE_TAG,
  mergeLanguageInjectionEnv,
  removeLanguageInjectionEnv,
  resolveSsiConfig,
  selectApplicationContainer,
} from '../ssi'

import {DEFAULT_CONFIG, DEFAULT_CONTAINER_APP} from './common'

const injectConfig = (language: ContainerAppConfigOptions['language'] = 'nodejs'): ContainerAppConfigOptions => ({
  ...DEFAULT_CONFIG,
  service: DEFAULT_CONTAINER_APP.name,
  sourceCodeIntegration: false,
  tracing: 'inject',
  language,
})

const getEnv = (env: EnvironmentVar[] | undefined, name: string) => env?.find((variable) => variable.name === name)

const createInstrumentedApp = (config: ContainerAppConfigOptions, app: ContainerApp = DEFAULT_CONTAINER_APP) => {
  const command = createCommand(InstrumentCommand)

  return command.createInstrumentedAppConfig(config, DEFAULT_CONFIG.subscriptionId!, DEFAULT_CONFIG.resourceGroup!, app)
}

describe('Container Apps automatic APM instrumentation', () => {
  describe('input resolution', () => {
    test.each([
      [undefined, undefined],
      ['manual', 'manual'],
      ['true', 'manual'],
      ['1', 'manual'],
      ['disabled', 'disabled'],
      ['false', 'disabled'],
      ['0', 'disabled'],
    ] as const)('resolves tracing input %s without injection', (tracing, expected) => {
      expect(resolveSsiConfig({...DEFAULT_CONFIG, tracing})).toEqual({
        kind: 'no-injection',
        tracing: expected,
        warnings: [],
      })
    })

    test.each<[Language, string]>([
      ['java', 'java'],
      ['nodejs', 'js'],
      ['csharp', 'dotnet'],
      ['python', 'python'],
      ['ruby', 'ruby'],
      ['php', 'php'],
    ])('uses the Azure tracer image for %s', (language, tracerLanguage) => {
      const result = resolveSsiConfig(injectConfig(language))

      expect(result.kind).toBe('single-language')
      expect(result.kind === 'single-language' && result.spec.image).toBe(
        `datadoghq.azurecr.io/dd-lib-${tracerLanguage}-init:latest`
      )
      expect(result.kind === 'single-language' && result.libc).toBe('glibc')
    })

    test.each([
      [{tracing: 'inject'}, '--language'],
      [{tracing: 'inject', language: 'go'}, 'dd-trace-go'],
      [{tracerVersion: '1.2.3'}, '--tracing inject'],
      [{tracerLibc: 'musl'}, '--tracing inject'],
      [{tracing: 'inject', language: 'ruby', tracerLibc: 'musl'}, 'does not support musl'],
      [{tracing: 'inject', language: 'csharp', tracerVersion: '2.51.0'}, 'version 3.0 or later'],
    ] satisfies [Partial<ContainerAppConfigOptions>, string][])(
      'rejects incompatible options %#',
      (options, message) => {
        const result = resolveSsiConfig({...DEFAULT_CONFIG, ...options})

        expect(result.kind).toBe('errors')
        expect(result.kind === 'errors' && result.errors.join('\n')).toContain(message)
      }
    )

    test('warns for Java 24+', () => {
      expect(resolveSsiConfig(injectConfig('java')).warnings.join('\n')).toContain('Java 24+')
    })
  })

  describe('application container selection', () => {
    const containers = [{name: 'app'}, {name: 'worker'}, {name: 'datadog-sidecar'}]

    test('selects the sole non-Agent container', () => {
      expect(selectApplicationContainer([containers[0], containers[2]], 'datadog-sidecar', undefined)).toBe(0)
    })

    test.each(['worker', ' worker '])('selects an explicit container from a multi-container app', (name) => {
      expect(selectApplicationContainer(containers, 'datadog-sidecar', name)).toBe(1)
    })

    test('treats a blank selector as omitted', () => {
      expect(selectApplicationContainer([containers[0], containers[2]], 'datadog-sidecar', '   ')).toBe(0)
    })

    test.each([
      [undefined, 'multiple candidates'],
      ['missing', 'was not found'],
    ])('rejects an invalid selector %s', (name, message) => {
      expect(() => selectApplicationContainer(containers, 'datadog-sidecar', name)).toThrow(message)
    })
  })

  describe('native environment', () => {
    const nodeResult = resolveSsiConfig(injectConfig('nodejs'))
    const nodeSpec = nodeResult.kind === 'single-language' ? nodeResult.spec : undefined

    test('merges and removes exact tracer fragments without replacing unrelated values', () => {
      const original = [
        {name: 'NODE_OPTIONS', value: '--inspect'},
        {name: 'DD_TAGS', value: 'team:serverless'},
        {name: 'KEEP', value: 'value'},
      ]
      const merged = mergeLanguageInjectionEnv(original, nodeSpec!)

      expect(getEnv(merged, 'NODE_OPTIONS')?.value).toBe(
        '--inspect --require /datadog-lib/node_modules/dd-trace/init.js'
      )
      expect(getEnv(merged, 'DD_TAGS')?.value).toBe(`${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:serverless`)
      expect(removeLanguageInjectionEnv(merged)).toEqual(original)
    })

    test.each([
      [
        {name: 'NODE_OPTIONS', value: 'first'},
        {name: 'NODE_OPTIONS', value: 'second'},
      ],
      [{name: 'NODE_OPTIONS', secretRef: 'node-options'}],
    ])('rejects an unsafe managed environment %#', (...env) => {
      expect(() => mergeLanguageInjectionEnv(env, nodeSpec!)).toThrow(/NODE_OPTIONS/)
    })

    test('rejects a conflicting scalar value', () => {
      const dotnet = resolveSsiConfig(injectConfig('csharp'))
      const spec = dotnet.kind === 'single-language' ? dotnet.spec : undefined

      expect(() => mergeLanguageInjectionEnv([{name: 'CORECLR_ENABLE_PROFILING', value: '0'}], spec!)).toThrow(
        /expected "1"/
      )
    })

    test('enforces the .NET LD_PRELOAD limit', () => {
      const dotnet = resolveSsiConfig(injectConfig('csharp'))
      const spec = dotnet.kind === 'single-language' ? dotnet.spec : undefined

      expect(() => mergeLanguageInjectionEnv([{name: 'LD_PRELOAD', value: 'x'.repeat(1024)}], spec!)).toThrow(
        /1024-byte limit/
      )
    })
  })

  describe('ARM configuration', () => {
    test.each<[Language, string, string]>([
      ['java', 'JAVA_TOOL_OPTIONS', '-javaagent:/datadog-lib/dd-java-agent.jar'],
      ['nodejs', 'NODE_OPTIONS', '--require /datadog-lib/node_modules/dd-trace/init.js'],
      ['csharp', 'DD_DOTNET_TRACER_HOME', '/datadog-lib'],
      ['python', 'PYTHONPATH', '/datadog-lib'],
      ['ruby', 'RUBYOPT', '-r/datadog-lib/auto_inject'],
      ['php', 'DD_LOADER_PACKAGE_PATH', '/datadog-lib'],
    ])('adds the %s native environment to the selected application container', (language, envName, value) => {
      const result = createInstrumentedApp(injectConfig(language))
      const app = result.template!.containers![0]

      expect(getEnv(app.env, envName)?.value).toContain(value)
      expect(getEnv(app.env, DD_TRACE_ENABLED_ENV_VAR)?.value).toBe('true')
      expect(getEnv(app.env, 'DD_TAGS')?.value).toContain(SINGLE_LANGUAGE_INJECTION_MODE_TAG)
      expect(result.template?.initContainers).toContainEqual({
        name: TRACER_CONTAINER_NAME,
        image: expect.stringContaining('datadoghq.azurecr.io/dd-lib-'),
        command: ['/datadog-init/copy-lib.sh'],
        args: [TRACER_MOUNT_PATH],
        resources: {cpu: 0.25, memory: '0.5Gi'},
        volumeMounts: [{volumeName: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH}],
      })
      expect(result.template?.volumes).toContainEqual({name: TRACER_VOLUME_NAME, storageType: 'EmptyDir'})
      expect(app.volumeMounts).toContainEqual({volumeName: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH})
      expect(
        result.template?.containers?.find(({name}) => name === 'datadog-sidecar')?.volumeMounts
      ).not.toContainEqual(expect.objectContaining({volumeName: TRACER_VOLUME_NAME}))
    })

    test('instruments only the explicitly selected application container', () => {
      const worker = {name: 'worker', image: 'worker', env: [{name: 'ROLE', value: 'worker'}]}
      const app = {
        ...DEFAULT_CONTAINER_APP,
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [...DEFAULT_CONTAINER_APP.template!.containers!, worker],
          initContainers: [{name: 'customer-init', image: 'customer-init'}],
          volumes: [{name: 'customer-volume', storageType: 'EmptyDir'}],
        },
      }
      const result = createInstrumentedApp({...injectConfig(), containerName: 'worker'}, app)
      const main = result.template!.containers![0]
      const selected = result.template!.containers![1]

      expect(getEnv(main.env, 'NODE_OPTIONS')).toBeUndefined()
      expect(main.volumeMounts).not.toContainEqual(expect.objectContaining({volumeName: TRACER_VOLUME_NAME}))
      expect(getEnv(selected.env, 'NODE_OPTIONS')).toBeDefined()
      expect(result.template?.initContainers?.[0]).toEqual({name: 'customer-init', image: 'customer-init'})
      expect(result.template?.volumes?.[0]).toEqual({name: 'customer-volume', storageType: 'EmptyDir'})
    })

    test.each([
      ['sharedVolumeName', TRACER_VOLUME_NAME, '--shared-volume-name'],
      ['sharedVolumePath', TRACER_MOUNT_PATH, '--shared-volume-path'],
    ] as const)('rejects the tracer collision on %s', (field, value, message) => {
      expect(() => createInstrumentedApp({...injectConfig(), [field]: value})).toThrow(message)
    })

    test('retries markerless configuration without duplicating managed state', () => {
      const first = createInstrumentedApp(injectConfig())
      const second = createInstrumentedApp(injectConfig(), first)

      expect(second.template).toEqual(first.template)
    })

    test('validates stale managed environment before a language transition', () => {
      const node = createInstrumentedApp(injectConfig())
      const app = node.template!.containers![0]
      const unsafe = {
        ...node,
        tags: {...node.tags, [SSI_INJECTION_MODE_TAG]: SINGLE_LANGUAGE_SSI_MODE},
        template: {
          ...node.template,
          containers: [
            {...app, env: [...(app.env ?? []), {name: 'NODE_OPTIONS', value: '--customer-option'}]},
            ...node.template!.containers!.slice(1),
          ],
        },
      }

      expect(() => createInstrumentedApp(injectConfig('python'), unsafe)).toThrow(/NODE_OPTIONS appears more than once/)
    })

    test('replaces an owned tracer with another language', () => {
      const node = createInstrumentedApp(injectConfig())
      const owned = {
        ...node,
        tags: {...node.tags, [SSI_INJECTION_MODE_TAG]: SINGLE_LANGUAGE_SSI_MODE},
      }
      const python = createInstrumentedApp(injectConfig('python'), owned)
      const app = python.template!.containers![0]

      expect(getEnv(app.env, 'NODE_OPTIONS')).toBeUndefined()
      expect(getEnv(app.env, 'PYTHONPATH')?.value).toBe(TRACER_MOUNT_PATH)
      expect(python.template?.initContainers).toHaveLength(1)
      expect(python.template?.volumes?.filter(({name}) => name === TRACER_VOLUME_NAME)).toHaveLength(1)
    })

    test.each([
      ['manual', 'true'],
      ['disabled', 'false'],
    ] as const)('removes owned injection for %s tracing', (tracing, traceEnabled) => {
      const injected = createInstrumentedApp(injectConfig())
      const owned = {
        ...injected,
        tags: {...injected.tags, [SSI_INJECTION_MODE_TAG]: SINGLE_LANGUAGE_SSI_MODE},
      }
      const result = createInstrumentedApp({...DEFAULT_CONFIG, service: 'my-container-app', tracing}, owned)
      const app = result.template!.containers![0]

      expect(result.template?.initContainers).toEqual([])
      expect(result.template?.volumes).not.toContainEqual(expect.objectContaining({name: TRACER_VOLUME_NAME}))
      expect(app.volumeMounts).not.toContainEqual(expect.objectContaining({volumeName: TRACER_VOLUME_NAME}))
      expect(getEnv(app.env, 'NODE_OPTIONS')).toBeUndefined()
      expect(getEnv(app.env, DD_TRACE_ENABLED_ENV_VAR)?.value).toBe(traceEnabled)
    })

    test('omitted tracing preserves existing injection when updating DD_TAGS', () => {
      const injected = createInstrumentedApp(injectConfig())
      const result = createInstrumentedApp(
        {...DEFAULT_CONFIG, service: 'my-container-app', extraTags: 'team:serverless'},
        injected
      )

      expect(result.template?.initContainers).toEqual(injected.template?.initContainers)
      expect(getEnv(result.template?.containers?.[0].env, 'NODE_OPTIONS')).toEqual(
        getEnv(injected.template?.containers?.[0].env, 'NODE_OPTIONS')
      )
      expect(getEnv(result.template?.containers?.[0].env, 'DD_TAGS')?.value).toBe(
        `${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:serverless`
      )
    })
  })
})
