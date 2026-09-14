import type {InstrumentSettings} from '../task-definition'
import type {ContainerDefinition, KeyValuePair} from '@aws-sdk/client-ecs'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {DD_TRACE_ENABLED_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  COMPOSITE_TRACER_MOUNT_PATH,
  getCompositeInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import {
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {AGENT_CONTAINER_NAME, SUCCESS_DEPENDENCY_CONDITION} from '../constants'
import {
  ECS_FARGATE_TRACER_REGISTRY,
  MULTI_LANGUAGE_SSI_MODE,
  SINGLE_LANGUAGE_SSI_MODE,
  SSI_INJECTION_MODE_TAG,
  hasSsi,
  mergeCompositeInjectionEnv,
  mergeLanguageInjectionEnv,
  removeInjectionEnv,
  resolveSsiConfig,
  selectApplicationContainer,
} from '../ssi'
import {instrumentTaskDefinition, uninstrumentTaskDefinition} from '../task-definition'

import {APP_CONTAINER, MOCK_SETTINGS, fargateTaskDefinition, windowsTaskDefinition} from './fixtures'

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
      [{tracing: 'yes'}, 'Invalid tracing mode'],
    ])('rejects incompatible options %#', (options, message) => {
      const result = resolveSsiConfig(options)

      expect(result.kind).toBe('errors')
      expect(result.kind === 'errors' && result.errors.join('\n')).toContain(message)
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
      const merged = mergeLanguageInjectionEnv(original, nodeSpec!, false)

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
      const merged = mergeCompositeInjectionEnv(original, compositeSpec, false)

      expect(merged).toEqual([
        {
          name: 'LD_PRELOAD',
          value: `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so /customer/preload.so`,
        },
        {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'},
      ])
      expect(mergeCompositeInjectionEnv({...original, environment: merged}, compositeSpec, false)).toEqual(merged)
      expect(removeInjectionEnv({...original, environment: merged}, false)).toEqual(original.environment)
    })

    test('rejects a secret-backed managed environment', () => {
      expect(() =>
        mergeLanguageInjectionEnv(
          {name: 'app', secrets: [{name: 'NODE_OPTIONS', valueFrom: 'arn:aws:secretsmanager:secret'}]},
          nodeSpec!,
          false
        )
      ).toThrow(/NODE_OPTIONS/)
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

    test('rejects a customer container that already uses the tracer name', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [APP_CONTAINER, {name: TRACER_CONTAINER_NAME, image: 'customer:latest'}],
      })

      expect(() => instrumentTaskDefinition(original, injectSettings('nodejs'))).toThrow(
        `A container named '${TRACER_CONTAINER_NAME}' already exists`
      )
    })

    test('switches between single- and multi-language injection idempotently', () => {
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
      expect(hasSsi({...fargateTaskDefinition(), ...first.taskDefinition}, first.taskDefinition.tags)).toBe(true)
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
  })
})
