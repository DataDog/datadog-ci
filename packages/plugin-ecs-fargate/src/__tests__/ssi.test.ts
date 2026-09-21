import type {SsiOptions} from '../ssi'
import type {InstrumentSettings} from '../task-definition'
import type {ContainerDefinition, KeyValuePair} from '@aws-sdk/client-ecs'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {DD_TRACE_ENABLED_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  COMPOSITE_TRACER_MOUNT_PATH,
  getCompositeInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import {
  MULTI_LANGUAGE_SSI_MODE,
  SINGLE_LANGUAGE_SSI_MODE,
  SSI_INJECTION_MODE_TAG,
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME, SUCCESS_DEPENDENCY_CONDITION, TRACER_USER} from '../constants'
import {
  ECS_FARGATE_TRACER_REGISTRY,
  hasSsi,
  mergeCompositeInjectionEnv,
  mergeLanguageInjectionEnv,
  removeInjectionEnv,
  resolveSsiConfig,
  selectApplicationContainer,
} from '../ssi'
import {isUpToDate, stripReadOnlyFields, uninstrumentTaskDefinition} from '../task-definition'

import {
  APP_CONTAINER,
  MOCK_SETTINGS,
  fargateTaskDefinition,
  instrumentTaskDefinition,
  windowsTaskDefinition,
} from './fixtures'

const injectSettings = (language?: string, overrides: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...MOCK_SETTINGS,
  tracing: 'inject',
  language,
  ...overrides,
})

const compositeSpec = getCompositeInjectionSpec(ECS_FARGATE_TRACER_REGISTRY)

const envVarsOf = (container: ContainerDefinition | undefined) =>
  Object.fromEntries((container?.environment ?? []).map(({name, value}) => [name, value]))

const getEnv = (env: KeyValuePair[] | undefined, name: string) => env?.find((variable) => variable.name === name)

const tracerOf = (containers: ContainerDefinition[] | undefined) =>
  containers?.find((container) => container.name === TRACER_CONTAINER_NAME)

const appOf = (containers: ContainerDefinition[] | undefined, name = APP_CONTAINER.name) =>
  containers?.find((container) => container.name === name)

describe('ECS Fargate automatic APM instrumentation', () => {
  describe('input resolution', () => {
    test.each([
      [undefined, 'manual'],
      ['manual', 'manual'],
      ['disabled', 'disabled'],
    ] as const)('resolves tracing input %s without injection', (tracing, expected) => {
      expect(resolveSsiConfig({tracing})).toEqual({
        kind: 'no-injection',
        tracing: expected,
        warnings: [],
      })
    })

    test('uses the AWS composite when the language is omitted', () => {
      expect(resolveSsiConfig({tracing: 'inject'})).toEqual({
        kind: 'multi-language',
        spec: compositeSpec,
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
    ])('uses the AWS tracer image for %s', (language, tracerLanguage) => {
      const result = resolveSsiConfig({tracing: 'inject', language})

      expect(result.kind).toBe('single-language')
      expect(result.kind === 'single-language' && result.spec.image).toBe(
        `public.ecr.aws/datadog/dd-lib-${tracerLanguage}-init:latest`
      )
      expect(result.kind === 'single-language' && result.libc).toBe('glibc')
    })

    test('accepts dotnet as an alias for csharp', () => {
      const result = resolveSsiConfig({tracing: 'inject', language: 'dotnet'})

      expect(result.kind).toBe('single-language')
      expect(result.kind === 'single-language' && result.language).toBe('csharp')
    })

    test('does not apply Cloud Run probe-server version floors', () => {
      expect(resolveSsiConfig({tracing: 'inject', language: 'python', tracerVersion: '4.12.9'}).kind).toBe(
        'single-language'
      )
    })

    test.each([
      [{tracing: 'inject', tracerVersion: '1.2.3'}, '--tracer-version'],
      [{tracing: 'inject', tracerLibc: 'musl'}, '--tracer-libc'],
      [{tracing: 'inject', language: 'go'}, 'Install dd-trace-go'],
      [{tracing: 'inject', language: 'rust'}, 'supports only these languages'],
      [{tracerVersion: '1.2.3'}, '--tracing inject'],
      [{tracerLibc: 'musl'}, '--tracing inject'],
      [{tracing: 'inject', language: 'ruby', tracerLibc: 'musl'}, 'does not support musl'],
      [{tracing: 'inject', language: 'csharp', tracerVersion: '2.51.0'}, 'version 3.0 or later'],
    ] satisfies [SsiOptions, string][])('rejects incompatible options %#', (options, message) => {
      const result = resolveSsiConfig(options)

      expect(result.kind).toBe('errors')
      expect(result.kind === 'errors' && result.errors.join('\n')).toContain(message)
    })

    // Values a configuration file can hold, which the CLI validators never see.
    test.each([
      [{tracing: 'yes'}, 'Invalid tracing mode'],
      [{tracerLibc: 'uclibc'}, 'Invalid tracer libc'],
      [{tracing: 'inject', language: 'nodejs', tracerVersion: 'not a tag'}, 'Invalid tracer version'],
      [{tracing: 'inject', language: 'nodejs', containerName: 7}, 'Invalid application container name'],
    ])('rejects malformed configuration %#', (options, message) => {
      const result = resolveSsiConfig(options as SsiOptions)

      expect(result.kind).toBe('errors')
      expect(result.kind === 'errors' && result.errors.join('\n')).toContain(message)
    })

    test('accepts --container-name with multi-language injection', () => {
      expect(resolveSsiConfig({tracing: 'inject', containerName: 'app'}).kind).toBe('multi-language')
    })

    // Rejecting it would break configuration files that already carry it, so it is reported instead.
    test.each([undefined, 'manual', 'disabled'] as const)('ignores --container-name with --tracing %s', (tracing) => {
      const result = resolveSsiConfig({tracing, containerName: 'app'})

      expect(result.kind).toBe('no-injection')
      expect(result.warnings.join('\n')).toContain('Ignoring --container-name')
    })

    test('accepts arbitrary language values without injection', () => {
      expect(resolveSsiConfig({tracing: 'manual', language: 'rust'})).toMatchObject({
        kind: 'no-injection',
        tracing: 'manual',
      })
    })

    test('warns for Java 24+', () => {
      expect(resolveSsiConfig({tracing: 'inject', language: 'java'}).warnings.join('\n')).toContain('Java 24+')
    })
  })

  describe('application container selection', () => {
    const containers = [{name: 'app'}, {name: 'worker'}, {name: AGENT_CONTAINER_NAME}]

    test('selects the sole non-sidecar container', () => {
      expect(selectApplicationContainer([containers[0], containers[2]], undefined)).toBe(0)
    })

    test.each(['worker', ' worker '])('selects an explicit container from a multi-container task', (name) => {
      expect(selectApplicationContainer(containers, name)).toBe(1)
    })

    test('treats a blank selector as omitted', () => {
      expect(selectApplicationContainer([containers[0], containers[2]], '   ')).toBe(0)
    })

    test.each([
      [undefined, 'multiple candidates'],
      ['missing', 'was not found'],
      [AGENT_CONTAINER_NAME, 'Cannot inject a tracer into'],
    ])('rejects an invalid selector %s', (name, message) => {
      expect(() => selectApplicationContainer(containers, name)).toThrow(message)
    })
  })

  describe('native environment', () => {
    const nodeResult = resolveSsiConfig({tracing: 'inject', language: 'nodejs'})
    const nodeSpec = nodeResult.kind === 'single-language' ? nodeResult.spec : undefined

    test('merges and removes exact tracer fragments without replacing unrelated values', () => {
      const original: ContainerDefinition = {
        name: 'app',
        environment: [
          {name: 'NODE_OPTIONS', value: '--inspect'},
          {name: 'DD_TAGS', value: 'team:serverless'},
          {name: 'KEEP', value: 'value'},
        ],
      }
      const merged = mergeLanguageInjectionEnv(original, nodeSpec!)

      expect(getEnv(merged, 'NODE_OPTIONS')?.value).toBe(
        '--inspect --require /datadog-lib/node_modules/dd-trace/init.js'
      )
      expect(getEnv(merged, 'DD_TAGS')?.value).toBe(`${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:serverless`)
      expect(removeInjectionEnv({...original, environment: merged}, false)).toEqual(original.environment)
    })

    test('merges and removes composite activation without replacing another preload', () => {
      const original: ContainerDefinition = {
        name: 'app',
        environment: [{name: 'LD_PRELOAD', value: '/customer/preload.so'}],
      }
      const merged = mergeCompositeInjectionEnv(original, compositeSpec)

      expect(merged).toEqual([
        {
          name: 'LD_PRELOAD',
          value: `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so /customer/preload.so`,
        },
        {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'},
      ])
      expect(mergeCompositeInjectionEnv({...original, environment: merged}, compositeSpec)).toEqual(merged)
      expect(removeInjectionEnv({...original, environment: merged}, false)).toEqual(original.environment)
    })

    test('rejects a secret-backed managed environment', () => {
      expect(() =>
        mergeLanguageInjectionEnv(
          {name: 'app', secrets: [{name: 'NODE_OPTIONS', valueFrom: 'arn:aws:secretsmanager:secret'}]},
          nodeSpec!
        )
      ).toThrow(/NODE_OPTIONS/)
    })

    test('removes tracer fragments from a Windows task whatever case the names use', () => {
      const container: ContainerDefinition = {
        name: 'app',
        environment: [
          {name: 'node_options', value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js'},
          {name: 'Dd_Tags', value: `${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:serverless`},
        ],
      }

      expect(removeInjectionEnv(container, true)).toEqual([
        {name: 'node_options', value: '--inspect'},
        {name: 'Dd_Tags', value: 'team:serverless'},
      ])
    })
  })

  describe('task definition', () => {
    test.each<[Language, string, string]>([
      ['java', 'JAVA_TOOL_OPTIONS', '-javaagent:/datadog-lib/dd-java-agent.jar'],
      ['nodejs', 'NODE_OPTIONS', '--require /datadog-lib/node_modules/dd-trace/init.js'],
      ['csharp', 'DD_DOTNET_TRACER_HOME', '/datadog-lib'],
      ['python', 'PYTHONPATH', '/datadog-lib'],
      ['ruby', 'RUBYOPT', '-r/datadog-lib/auto_inject'],
      ['php', 'DD_LOADER_PACKAGE_PATH', '/datadog-lib'],
    ])('adds the %s native environment to the selected application container', (language, envName, value) => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings(language))
      const app = appOf(taskDefinition.containerDefinitions)
      const tracer = tracerOf(taskDefinition.containerDefinitions)

      expect(envVarsOf(app)[envName]).toContain(value)
      expect(envVarsOf(app).DD_SOURCE).toBe(language)
      expect(envVarsOf(app)[DD_TRACE_ENABLED_ENV_VAR]).toBe('true')
      expect(envVarsOf(app).DD_TAGS).toContain(SINGLE_LANGUAGE_INJECTION_MODE_TAG)
      expect(app?.dependsOn).toContainEqual({
        containerName: TRACER_CONTAINER_NAME,
        condition: SUCCESS_DEPENDENCY_CONDITION,
      })
      expect(app?.mountPoints).toContainEqual({
        sourceVolume: TRACER_VOLUME_NAME,
        containerPath: TRACER_MOUNT_PATH,
        readOnly: false,
      })
      expect(tracer).toMatchObject({
        name: TRACER_CONTAINER_NAME,
        image: expect.stringContaining('public.ecr.aws/datadog/dd-lib-'),
        essential: false,
        user: TRACER_USER,
        entryPoint: ['/datadog-init/copy-lib.sh'],
        command: [TRACER_MOUNT_PATH],
      })
      expect(taskDefinition.volumes).toContainEqual({name: TRACER_VOLUME_NAME})
      expect(taskDefinition.tags).toContainEqual({key: SSI_INJECTION_MODE_TAG, value: SINGLE_LANGUAGE_SSI_MODE})
      expect(
        envVarsOf(taskDefinition.containerDefinitions?.find((container) => container.name === AGENT_CONTAINER_NAME))
      ).not.toHaveProperty('NODE_OPTIONS')
    })

    test('adds composite activation only to the selected application container', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings())
      const app = appOf(taskDefinition.containerDefinitions)
      const tracer = tracerOf(taskDefinition.containerDefinitions)
      const agent = taskDefinition.containerDefinitions?.find((container) => container.name === AGENT_CONTAINER_NAME)

      expect(envVarsOf(app).LD_PRELOAD).toBe(compositeSpec.env[0].value)
      expect(envVarsOf(app).DD_INJECT_SENDER_TYPE).toBe('serverless')
      expect(envVarsOf(app).DD_SOURCE).toBeUndefined()
      expect(envVarsOf(app).DD_TAGS).toBeUndefined()
      expect(app?.mountPoints).toContainEqual({
        sourceVolume: TRACER_VOLUME_NAME,
        containerPath: COMPOSITE_TRACER_MOUNT_PATH,
        readOnly: false,
      })
      expect(tracer).toMatchObject({
        image: 'public.ecr.aws/datadog/dd-lib-composite-init:latest',
        user: TRACER_USER,
        command: [COMPOSITE_TRACER_MOUNT_PATH],
      })
      expect(envVarsOf(agent).LD_PRELOAD).toBeUndefined()
      expect(agent?.mountPoints).not.toContainEqual(expect.objectContaining({sourceVolume: TRACER_VOLUME_NAME}))
      expect(taskDefinition.tags).toContainEqual({key: SSI_INJECTION_MODE_TAG, value: MULTI_LANGUAGE_SSI_MODE})
    })

    test('instruments only the explicitly selected application container', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [APP_CONTAINER, {name: 'worker', image: 'worker:latest', essential: true}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, injectSettings('nodejs', {containerName: 'worker'}))
      const app = appOf(taskDefinition.containerDefinitions)
      const worker = appOf(taskDefinition.containerDefinitions, 'worker')

      expect(envVarsOf(app).NODE_OPTIONS).toBeUndefined()
      expect(app?.mountPoints).not.toContainEqual(expect.objectContaining({sourceVolume: TRACER_VOLUME_NAME}))
      expect(envVarsOf(worker).NODE_OPTIONS).toBeDefined()
      expect(worker?.dependsOn).toContainEqual({
        containerName: TRACER_CONTAINER_NAME,
        condition: SUCCESS_DEPENDENCY_CONDITION,
      })
    })

    test('rejects a multi-container task without --container-name', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [APP_CONTAINER, {name: 'worker', image: 'worker:latest'}],
      })

      expect(() => instrumentTaskDefinition(original, injectSettings('nodejs'))).toThrow('multiple candidates')
    })

    test('rejects injection on Windows tasks', () => {
      expect(() => instrumentTaskDefinition(windowsTaskDefinition(), injectSettings('nodejs'))).toThrow(
        'automatic tracer injection does not support'
      )
    })

    test('rejects .NET injection on ARM64 tasks', () => {
      const original = fargateTaskDefinition({
        runtimePlatform: {operatingSystemFamily: 'LINUX', cpuArchitecture: 'ARM64'},
      })

      expect(() => instrumentTaskDefinition(original, injectSettings('csharp'))).toThrow('runs ARM64')
      expect(() => instrumentTaskDefinition(original, injectSettings('dotnet'))).toThrow('runs ARM64')
    })

    test('injects Node.js on ARM64 tasks', () => {
      const original = fargateTaskDefinition({
        runtimePlatform: {operatingSystemFamily: 'LINUX', cpuArchitecture: 'ARM64'},
      })
      const {taskDefinition} = instrumentTaskDefinition(original, injectSettings('nodejs'))

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions)).NODE_OPTIONS).toBeDefined()
    })

    test('instruments the application container after dropping a leading log router', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{name: LOG_ROUTER_CONTAINER_NAME, image: 'fluentbit:latest'}, APP_CONTAINER],
      })
      const {taskDefinition} = instrumentTaskDefinition(original, injectSettings('nodejs'))

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions)).NODE_OPTIONS).toBeDefined()
      expect(
        envVarsOf(taskDefinition.containerDefinitions?.find((container) => container.name === AGENT_CONTAINER_NAME))
      ).not.toHaveProperty('NODE_OPTIONS')
    })

    test('sets DD_SOURCE without injecting a tracer when only --language is provided', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        language: 'python',
      })

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions)).DD_SOURCE).toBe('python')
      expect(tracerOf(taskDefinition.containerDefinitions)).toBeUndefined()
    })

    test('prepends the injection mode tag to extra tags on the selected container only', () => {
      const {taskDefinition} = instrumentTaskDefinition(
        fargateTaskDefinition(),
        injectSettings('nodejs', {extraTags: 'team:intake'})
      )
      const app = appOf(taskDefinition.containerDefinitions)
      const agent = taskDefinition.containerDefinitions?.find((container) => container.name === AGENT_CONTAINER_NAME)

      expect(envVarsOf(app).DD_TAGS).toBe(`${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:intake`)
      expect(envVarsOf(agent).DD_TAGS).toBe('team:intake')
    })

    // The shape check only recognizes what this release writes, so a tracer container left by
    // another release or another tool has to be replaced rather than reported as a collision.
    const staleTracerTaskDefinition = () =>
      fargateTaskDefinition({
        containerDefinitions: [
          APP_CONTAINER,
          {
            name: TRACER_CONTAINER_NAME,
            image: 'public.ecr.aws/datadog/dd-lib-js-init:v2',
            essential: false,
            entryPoint: ['/datadog-init/copy-lib.sh'],
            command: ['/some-other-path'],
            mountPoints: [{sourceVolume: TRACER_VOLUME_NAME, containerPath: '/some-other-path'}],
          },
        ],
        volumes: [{name: TRACER_VOLUME_NAME}],
      })

    test('replaces an unrecognized tracer container when injecting', () => {
      const original = staleTracerTaskDefinition()
      expect(hasSsi(original, [])).toBe(false)

      const {taskDefinition} = instrumentTaskDefinition(original, injectSettings('nodejs'))

      expect(taskDefinition.containerDefinitions?.filter(({name}) => name === TRACER_CONTAINER_NAME)).toHaveLength(1)
      expect(tracerOf(taskDefinition.containerDefinitions)?.command).toEqual([TRACER_MOUNT_PATH])
      expect(taskDefinition.volumes?.filter(({name}) => name === TRACER_VOLUME_NAME)).toHaveLength(1)
    })

    test('reports replacing a tracer container it did not write', () => {
      const {warnings} = instrumentTaskDefinition(staleTracerTaskDefinition(), MOCK_SETTINGS)

      expect(warnings.join('\n')).toContain(`declares a ${TRACER_CONTAINER_NAME} container or volume`)
    })

    test('reports replacing a customer mount at an owned tracer path', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {
            ...APP_CONTAINER,
            mountPoints: [{sourceVolume: 'app-data', containerPath: TRACER_MOUNT_PATH}],
          },
        ],
        volumes: [{name: 'app-data'}],
      })

      const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)
      const app = appOf(taskDefinition.containerDefinitions)

      expect(warnings.join('\n')).toContain(`mounts ${TRACER_MOUNT_PATH}`)
      expect(app?.mountPoints).not.toContainEqual(expect.objectContaining({containerPath: TRACER_MOUNT_PATH}))
      expect(taskDefinition.volumes).toContainEqual({name: 'app-data'})
    })

    test('says nothing about the tracer container it wrote itself', () => {
      const injected = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('nodejs'))
      const {warnings} = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...injected.taskDefinition},
        injectSettings('nodejs'),
        injected.taskDefinition.tags
      )

      expect(warnings.join('\n')).not.toContain(`declares a ${TRACER_CONTAINER_NAME} container or volume`)
    })

    test.each([['manual'], ['disabled']] as const)(
      '--tracing %s removes an unrecognized tracer container',
      (tracing) => {
        const {taskDefinition} = instrumentTaskDefinition(staleTracerTaskDefinition(), {...MOCK_SETTINGS, tracing})

        expect(tracerOf(taskDefinition.containerDefinitions)).toBeUndefined()
        expect(taskDefinition.volumes).not.toContainEqual({name: TRACER_VOLUME_NAME})
      }
    )

    test('warns before an omitted --tracing turns the task definition back on', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'}]}],
      })

      const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions))[DD_TRACE_ENABLED_ENV_VAR]).toBe('true')
      expect(warnings.join('\n')).toContain(`sets ${DD_TRACE_ENABLED_ENV_VAR} to "false"`)
    })

    test('leaves an explicit --tracing disabled unremarked', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'}]}],
      })

      const {taskDefinition, warnings} = instrumentTaskDefinition(original, {...MOCK_SETTINGS, tracing: 'disabled'})

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions))[DD_TRACE_ENABLED_ENV_VAR]).toBe('false')
      expect(warnings.join('\n')).not.toContain(DD_TRACE_ENABLED_ENV_VAR)
    })

    test('warns before an omitted --tracing removes an injected tracer', () => {
      const injected = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('nodejs'))
      const {warnings} = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...injected.taskDefinition},
        MOCK_SETTINGS,
        injected.taskDefinition.tags
      )

      expect(warnings.join('\n')).toContain('Tracing defaults to manual')
    })

    test('switches between single- and multi-language injection', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('nodejs'))
      const second = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...first.taskDefinition},
        injectSettings(),
        first.taskDefinition.tags
      )
      const third = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...second.taskDefinition},
        injectSettings('nodejs'),
        second.taskDefinition.tags
      )

      expect(envVarsOf(appOf(second.taskDefinition.containerDefinitions)).LD_PRELOAD).toBeDefined()
      expect(envVarsOf(appOf(second.taskDefinition.containerDefinitions)).NODE_OPTIONS).toBeUndefined()
      expect(envVarsOf(appOf(third.taskDefinition.containerDefinitions)).NODE_OPTIONS).toBeDefined()
      expect(envVarsOf(appOf(third.taskDefinition.containerDefinitions)).LD_PRELOAD).toBeUndefined()
    })

    const INJECTION_MODES: [string, Language | undefined][] = [
      ['single-language', 'nodejs'],
      ['multi-language', undefined],
    ]

    test.each(INJECTION_MODES)('re-injecting %s registers no new revision', (_, language) => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings(language))
      const described = {...fargateTaskDefinition(), ...first.taskDefinition}
      const second = instrumentTaskDefinition(described, injectSettings(language), first.taskDefinition.tags)

      expect(
        isUpToDate({...stripReadOnlyFields(described), tags: first.taskDefinition.tags}, second.taskDefinition)
      ).toBe(true)
    })

    test.each(INJECTION_MODES)('updates a %s tracer sidecar that was not running as root', (_, language) => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings(language))
      const described = {
        ...fargateTaskDefinition(),
        ...first.taskDefinition,
        containerDefinitions: first.taskDefinition.containerDefinitions?.map((container) => {
          if (container.name !== TRACER_CONTAINER_NAME) {
            return container
          }
          const rest = {...container}
          delete rest.user

          return rest
        }),
      }
      const second = instrumentTaskDefinition(described, injectSettings(language), first.taskDefinition.tags)

      expect(tracerOf(second.taskDefinition.containerDefinitions)?.user).toBe(TRACER_USER)
      expect(
        isUpToDate({...stripReadOnlyFields(described), tags: first.taskDefinition.tags}, second.taskDefinition)
      ).toBe(false)
    })

    // The tracer container mounts the volume it copies into, which must not make the task definition
    // unrecognizable once its tags are gone: a revision registered from described JSON carries none.
    test.each(INJECTION_MODES)('recognizes %s injection without the revision tags', (_, language) => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings(language))
      const untagged = {...fargateTaskDefinition(), ...first.taskDefinition}
      const second = instrumentTaskDefinition(untagged, injectSettings(language), [])

      expect(hasSsi(untagged, [])).toBe(true)
      expect(
        second.taskDefinition.containerDefinitions?.filter(({name}) => name === TRACER_CONTAINER_NAME)
      ).toHaveLength(1)
      expect(second.taskDefinition.volumes?.filter(({name}) => name === TRACER_VOLUME_NAME)).toHaveLength(1)
    })

    test.each([['manual'], ['disabled']] as const)('--tracing %s removes an injected tracer', (tracing) => {
      const injected = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('nodejs'))
      const {taskDefinition} = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...injected.taskDefinition},
        {...MOCK_SETTINGS, tracing},
        injected.taskDefinition.tags
      )
      const app = appOf(taskDefinition.containerDefinitions)

      expect(tracerOf(taskDefinition.containerDefinitions)).toBeUndefined()
      expect(taskDefinition.volumes).not.toContainEqual({name: TRACER_VOLUME_NAME})
      expect(envVarsOf(app).NODE_OPTIONS).toBeUndefined()
      expect(envVarsOf(app).DD_TAGS).toBeUndefined()
      expect(app?.dependsOn).toBeUndefined()
      expect(app?.mountPoints).not.toContainEqual(expect.objectContaining({sourceVolume: TRACER_VOLUME_NAME}))
      expect(taskDefinition.tags).not.toContainEqual(expect.objectContaining({key: SSI_INJECTION_MODE_TAG}))
    })

    // A .NET image carrying its own tracer sets the same two values injection would, so removing
    // them without the paths that name the tracer directory would stop its profiler from loading.
    const MANUAL_DOTNET_ENV: KeyValuePair[] = [
      {name: 'CORECLR_ENABLE_PROFILING', value: '1'},
      {name: 'CORECLR_PROFILER', value: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'},
      {name: 'CORECLR_PROFILER_PATH', value: '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so'},
      {name: 'DD_DOTNET_TRACER_HOME', value: '/opt/datadog'},
    ]

    test.each([undefined, 'manual', 'disabled'] as const)(
      '--tracing %s keeps a tracer the application image installs itself',
      (tracing) => {
        const original = fargateTaskDefinition({
          containerDefinitions: [{...APP_CONTAINER, environment: MANUAL_DOTNET_ENV}],
        })

        const {taskDefinition} = instrumentTaskDefinition(original, {...MOCK_SETTINGS, tracing})

        expect(envVarsOf(appOf(taskDefinition.containerDefinitions))).toMatchObject(
          Object.fromEntries(MANUAL_DOTNET_ENV.map(({name, value}) => [name, value]))
        )
      }
    )

    test('removes the shared .NET settings once the injected tracer shows it wrote them', () => {
      const injected = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('csharp'))
      const {taskDefinition} = instrumentTaskDefinition(
        {...fargateTaskDefinition(), ...injected.taskDefinition},
        {...MOCK_SETTINGS, tracing: 'manual'},
        injected.taskDefinition.tags
      )
      const app = envVarsOf(appOf(taskDefinition.containerDefinitions))

      expect(app).not.toHaveProperty('CORECLR_ENABLE_PROFILING')
      expect(app).not.toHaveProperty('CORECLR_PROFILER')
      expect(app).not.toHaveProperty('CORECLR_PROFILER_PATH')
      expect(app).not.toHaveProperty('DD_DOTNET_TRACER_HOME')
    })

    test('rejects an application container that declares a managed variable twice', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {
            ...APP_CONTAINER,
            environment: [
              {name: 'NODE_OPTIONS', value: '--inspect'},
              {name: 'NODE_OPTIONS', value: '--trace-warnings'},
            ],
          },
        ],
      })

      expect(() => instrumentTaskDefinition(original, injectSettings('nodejs'))).toThrow('appears more than once')
    })

    test('names the injected tracer in DD_SOURCE when --language is an alias', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), injectSettings('dotnet'))

      expect(envVarsOf(appOf(taskDefinition.containerDefinitions)).DD_SOURCE).toBe('csharp')
    })

    test('uninstrument removes tracer fragments, the tracer sidecar, and the injection tag', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'NODE_OPTIONS', value: '--inspect'}]}],
      })
      const injected = instrumentTaskDefinition(original, injectSettings('nodejs'))
      const {taskDefinition} = uninstrumentTaskDefinition(
        {...original, ...injected.taskDefinition},
        {},
        injected.taskDefinition.tags
      )

      expect(tracerOf(taskDefinition.containerDefinitions)).toBeUndefined()
      expect(taskDefinition.volumes).toEqual([])
      expect(envVarsOf(appOf(taskDefinition.containerDefinitions)).NODE_OPTIONS).toBe('--inspect')
      expect(appOf(taskDefinition.containerDefinitions)?.dependsOn).toBeUndefined()
      expect(taskDefinition.tags).not.toContainEqual(expect.objectContaining({key: SSI_INJECTION_MODE_TAG}))
    })

    test('uninstrument keeps a customer preload after removing composite injection', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'LD_PRELOAD', value: '/customer/preload.so'}]}],
      })
      const injected = instrumentTaskDefinition(original, injectSettings())
      const {taskDefinition} = uninstrumentTaskDefinition(
        {...original, ...injected.taskDefinition},
        {},
        injected.taskDefinition.tags
      )
      const app = envVarsOf(appOf(taskDefinition.containerDefinitions))

      expect(tracerOf(taskDefinition.containerDefinitions)).toBeUndefined()
      expect(app.LD_PRELOAD).toBe('/customer/preload.so')
      expect(app).not.toHaveProperty('DD_INJECT_SENDER_TYPE')
    })
  })
})
