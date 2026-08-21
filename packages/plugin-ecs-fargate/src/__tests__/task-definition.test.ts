import type {ContainerDefinition} from '@aws-sdk/client-ecs'

import {AGENT_IMAGE} from '@datadog/datadog-ci-base/helpers/serverless/constants'

import {AGENT_CONTAINER_NAME} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields} from '../task-definition'

import {
  APP_CONTAINER,
  CLI_VERSION_TAG,
  INSTRUMENTATION_TAGS,
  MOCK_API_KEY,
  MOCK_API_KEY_SECRET_ARN,
  MOCK_SETTINGS,
  SERVICE_TAG,
  fargateTaskDefinition,
} from './fixtures'

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const agentContainerOf = (containers: ContainerDefinition[] | undefined) =>
  containers?.find((container) => container.name === AGENT_CONTAINER_NAME)

const appContainerOf = (containers: ContainerDefinition[] | undefined) =>
  containers?.find((container) => container.name === APP_CONTAINER.name)

const envVarsOf = (container: ContainerDefinition | undefined) =>
  Object.fromEntries((container?.environment ?? []).map(({name, value}) => [name, value]))

describe('instrumentTaskDefinition', () => {
  test('adds the Agent sidecar', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(agent).toBeDefined()
    expect(agent?.image).toBe(AGENT_IMAGE)
    // A crashed Agent should cost telemetry, not availability.
    expect(agent?.essential).toBe(false)
    expect(envVarsOf(agent)).toStrictEqual({
      ECS_FARGATE: 'true',
      DD_SITE: 'datadoghq.com',
      DD_APM_ENABLED: 'true',
      DD_USE_DOGSTATSD: 'true',
      DD_ECS_TASK_COLLECTION_ENABLED: 'true',
      DD_SERVICE: 'my-app',
    })
    expect(agent?.healthCheck).toStrictEqual({
      command: ['CMD-SHELL', '/probe.sh'],
      interval: 15,
      timeout: 5,
      retries: 3,
      startPeriod: 60,
    })
  })

  test('runs the Agent image the settings ask for', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      ...MOCK_SETTINGS,
      agentImage: '123456789012.dkr.ecr.us-east-1.amazonaws.com/datadog/agent:7.60.0',
    })

    expect(agentContainerOf(taskDefinition.containerDefinitions)?.image).toBe(
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/datadog/agent:7.60.0'
    )
  })

  test('gives the application containers what their tracers read, leaving the rest alone', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    const app = appContainerOf(taskDefinition.containerDefinitions)
    expect(app).toStrictEqual({
      ...APP_CONTAINER,
      environment: [
        {name: 'PORT', value: '8080'},
        {name: 'DD_SERVICE', value: 'my-app'},
        {name: 'DD_TRACE_ENABLED', value: 'true'},
        {name: 'DD_LOGS_INJECTION', value: 'true'},
      ],
    })
  })

  test('references the API key secret rather than writing the key', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(agent?.secrets).toStrictEqual([{name: 'DD_API_KEY', valueFrom: MOCK_API_KEY_SECRET_ARN}])
    expect(envVarsOf(agent)).not.toHaveProperty('DD_API_KEY')
  })

  test('warns when the secret is referenced but no execution role can read it', () => {
    const original = fargateTaskDefinition({executionRoleArn: undefined})

    const {warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

    expect(warnings).toContainEqual(expect.stringContaining('no executionRoleArn'))
  })

  test('does not warn about an execution role when the API key is written in plain text', () => {
    const original = fargateTaskDefinition({executionRoleArn: undefined})

    const {warnings} = instrumentTaskDefinition(original, {
      agentImage: AGENT_IMAGE,
      site: 'datadoghq.com',
      apiKey: MOCK_API_KEY,
    })

    expect(warnings).not.toContainEqual(expect.stringContaining('no executionRoleArn'))
  })

  test('writes the API key in plain text when no secret ARN is given', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      agentImage: AGENT_IMAGE,
      site: 'datadoghq.com',
      apiKey: MOCK_API_KEY,
    })

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(envVarsOf(agent)).toHaveProperty('DD_API_KEY', MOCK_API_KEY)
    expect(agent?.secrets).toBeUndefined()
  })

  test('borrows the awslogs configuration from an application container', () => {
    const {taskDefinition, warnings} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(agent?.logConfiguration).toStrictEqual(APP_CONTAINER.logConfiguration)
    expect(warnings).toHaveLength(0)
  })

  test('warns when there is no log configuration to borrow', () => {
    const original = fargateTaskDefinition({
      containerDefinitions: [{...APP_CONTAINER, logConfiguration: undefined}],
    })

    const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

    expect(agentContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('no logConfiguration')])
  })

  test('does not borrow a log configuration from a non-awslogs driver', () => {
    const original = fargateTaskDefinition({
      containerDefinitions: [{...APP_CONTAINER, logConfiguration: {logDriver: 'awsfirelens'}}],
    })

    const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

    expect(agentContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toBeUndefined()
  })

  test('strips the read-only fields the register API rejects', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    expect(taskDefinition).not.toHaveProperty('taskDefinitionArn')
    expect(taskDefinition).not.toHaveProperty('revision')
    expect(taskDefinition).not.toHaveProperty('status')
    expect(taskDefinition).not.toHaveProperty('requiresAttributes')
    expect(taskDefinition).not.toHaveProperty('compatibilities')
    expect(taskDefinition).not.toHaveProperty('registeredAt')
    expect(taskDefinition).not.toHaveProperty('registeredBy')
    // The fields the new revision needs are kept.
    expect(taskDefinition.family).toBe('my-app')
    expect(taskDefinition.cpu).toBe('512')
    expect(taskDefinition.executionRoleArn).toBe('arn:aws:iam::123456789012:role/ecsTaskExecutionRole')
  })

  describe('unified service tagging', () => {
    test('names the service after the task definition family by default', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_SERVICE', 'my-app')
      expect(taskDefinition.tags).toContainEqual(SERVICE_TAG)
    })

    test('leaves a service the application container named itself', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'DD_SERVICE', value: 'checkout'}]}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_SERVICE', 'checkout')
    })

    test('overrides the container with an explicit service', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'DD_SERVICE', value: 'checkout'}]}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, {...MOCK_SETTINGS, service: 'payments'})

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_SERVICE', 'payments')
      expect(taskDefinition.tags).toContainEqual({key: 'service', value: 'payments'})
    })

    test('writes the environment, version, and extra tags to every container', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        environment: 'prod',
        version: '1.0.0',
        extraTags: 'team:intake,layer:api',
      })

      for (const container of taskDefinition.containerDefinitions ?? []) {
        expect(envVarsOf(container)).toMatchObject({
          DD_ENV: 'prod',
          DD_VERSION: '1.0.0',
          DD_TAGS: 'team:intake,layer:api',
        })
      }
      expect(taskDefinition.tags).toStrictEqual([
        SERVICE_TAG,
        {key: 'env', value: 'prod'},
        {key: 'version', value: '1.0.0'},
        CLI_VERSION_TAG,
      ])
    })
  })

  describe('product toggles', () => {
    test('turns tracing off on both the tracers and the Agent', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {...MOCK_SETTINGS, tracing: false})

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_TRACE_ENABLED', 'false')
      expect(envVarsOf(agentContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_APM_ENABLED', 'false')
    })

    test('leaves tracing as the application container set it', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'DD_TRACE_ENABLED', value: 'false'}]}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_TRACE_ENABLED', 'false')
    })

    test('enables tracing over the application container when asked to', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'DD_TRACE_ENABLED', value: 'false'}]}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, {...MOCK_SETTINGS, tracing: true})

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_TRACE_ENABLED', 'true')
    })

    test('sets the log level on the tracers and the Agent', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {...MOCK_SETTINGS, logLevel: 'debug'})

      for (const container of taskDefinition.containerDefinitions ?? []) {
        expect(envVarsOf(container)).toHaveProperty('DD_LOG_LEVEL', 'debug')
      }
    })

    test('enables Application Security Monitoring on the application containers only', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {...MOCK_SETTINGS, appsec: true})

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toHaveProperty('DD_APPSEC_ENABLED', 'true')
      expect(envVarsOf(agentContainerOf(taskDefinition.containerDefinitions))).not.toHaveProperty('DD_APPSEC_ENABLED')
    })

    test('enables LLM Observability against the Agent rather than the intake', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        llmobs: 'my-ml-app',
      })

      expect(envVarsOf(appContainerOf(taskDefinition.containerDefinitions))).toMatchObject({
        DD_LLMOBS_ENABLED: 'true',
        DD_LLMOBS_ML_APP: 'my-ml-app',
        DD_LLMOBS_AGENTLESS_ENABLED: 'false',
      })
    })

    test('sets the extra environment variables on every container, over what was there', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        envVars: {PORT: '9090', DD_PROFILING_ENABLED: 'true'},
      })

      for (const container of taskDefinition.containerDefinitions ?? []) {
        expect(envVarsOf(container)).toMatchObject({PORT: '9090', DD_PROFILING_ENABLED: 'true'})
      }
    })
  })

  describe('tags', () => {
    test('carries the existing tags onto the new revision', () => {
      const tags = [{key: 'team', value: 'intake'}]

      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, tags)

      expect(taskDefinition.tags).toStrictEqual([...tags, ...INSTRUMENTATION_TAGS])
    })

    test('tags the new revision with the service and the CLI version', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, [])

      expect(taskDefinition.tags).toStrictEqual(INSTRUMENTATION_TAGS)
    })

    test('replaces the tags an earlier run left behind', () => {
      const tags = [
        {key: 'team', value: 'intake'},
        {key: 'service', value: 'old-name'},
        {key: 'dd_sls_ci', value: 'v0.0.0'},
      ]

      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, tags)

      expect(taskDefinition.tags).toStrictEqual([{key: 'team', value: 'intake'}, ...INSTRUMENTATION_TAGS])
    })
  })

  describe('idempotency', () => {
    test('re-instrumenting produces an identical task definition', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      // What a second run sees: the registered revision, read-only fields and all.
      const described = fargateTaskDefinition({
        containerDefinitions: first.taskDefinition.containerDefinitions,
        revision: 2,
      })
      const second = instrumentTaskDefinition(described, MOCK_SETTINGS)

      expect(second.taskDefinition).toStrictEqual(first.taskDefinition)
      expect(second.warnings).toHaveLength(0)
    })

    test('an already instrumented task definition is unchanged by the transform', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
      const described = fargateTaskDefinition({
        containerDefinitions: first.taskDefinition.containerDefinitions,
      })

      const {taskDefinition} = instrumentTaskDefinition(described, MOCK_SETTINGS)

      expect(taskDefinition).toStrictEqual({...stripReadOnlyFields(described), tags: INSTRUMENTATION_TAGS})
    })

    test('does not add a second Agent container', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
      const described = fargateTaskDefinition({
        containerDefinitions: first.taskDefinition.containerDefinitions,
      })

      const {taskDefinition} = instrumentTaskDefinition(described, MOCK_SETTINGS)

      expect(
        taskDefinition.containerDefinitions?.filter((container) => container.name === AGENT_CONTAINER_NAME)
      ).toHaveLength(1)
    })
  })

  describe('existing Agent container', () => {
    test('preserves environment variables the user added by hand', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {...APP_CONTAINER},
          {
            name: AGENT_CONTAINER_NAME,
            image: 'public.ecr.aws/datadog/agent:7',
            environment: [{name: 'DD_PROCESS_AGENT_ENABLED', value: 'true'}],
          },
        ],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      const agent = agentContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(agent)).toHaveProperty('DD_PROCESS_AGENT_ENABLED', 'true')
      expect(envVarsOf(agent)).toHaveProperty('ECS_FARGATE', 'true')
      // The command owns the image.
      expect(agent?.image).toBe(AGENT_IMAGE)
    })

    test('preserves secrets the user added by hand', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {...APP_CONTAINER},
          {
            name: AGENT_CONTAINER_NAME,
            secrets: [{name: 'OTHER_SECRET', valueFrom: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:other'}],
          },
        ],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(agentContainerOf(taskDefinition.containerDefinitions)?.secrets).toStrictEqual([
        {name: 'OTHER_SECRET', valueFrom: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:other'},
        {name: 'DD_API_KEY', valueFrom: MOCK_API_KEY_SECRET_ARN},
      ])
    })

    test('moves a plaintext API key into the secret reference', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {...APP_CONTAINER},
          {name: AGENT_CONTAINER_NAME, environment: [{name: 'DD_API_KEY', value: MOCK_API_KEY}]},
        ],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      const agent = agentContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(agent)).not.toHaveProperty('DD_API_KEY')
      expect(agent?.secrets).toStrictEqual([{name: 'DD_API_KEY', valueFrom: MOCK_API_KEY_SECRET_ARN}])
    })

    test('warns when it has to override an essential Agent container', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER}, {name: AGENT_CONTAINER_NAME, essential: true}],
      })

      const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(agentContainerOf(taskDefinition.containerDefinitions)?.essential).toBe(false)
      expect(warnings).toContainEqual(expect.stringContaining('non-essential'))
    })

    test('warns when it replaces a health check the user wrote', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [
          {...APP_CONTAINER},
          {name: AGENT_CONTAINER_NAME, healthCheck: {command: ['CMD-SHELL', 'exit 0']}},
        ],
      })

      const {warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(warnings).toContainEqual(expect.stringContaining('health check'))
    })
  })

  describe('validation', () => {
    test('rejects a task definition that is not awsvpc', () => {
      const original = fargateTaskDefinition({networkMode: 'bridge'})

      expect(() => instrumentTaskDefinition(original, MOCK_SETTINGS)).toThrow(
        'Task definition my-app uses the bridge network mode. Fargate requires awsvpc.'
      )
    })

    test('rejects a task definition with no network mode', () => {
      const original = fargateTaskDefinition({networkMode: undefined})

      expect(() => instrumentTaskDefinition(original, MOCK_SETTINGS)).toThrow('uses the default network mode')
    })

    test('rejects a task definition that cannot run on Fargate', () => {
      const original = fargateTaskDefinition({requiresCompatibilities: ['EC2']})

      expect(() => instrumentTaskDefinition(original, MOCK_SETTINGS)).toThrow(
        'does not declare FARGATE in requiresCompatibilities'
      )
    })

    test('accepts a task definition that declares no compatibilities', () => {
      const original = fargateTaskDefinition({requiresCompatibilities: undefined})

      expect(() => instrumentTaskDefinition(original, MOCK_SETTINGS)).not.toThrow()
    })
  })
})

describe('isUpToDate', () => {
  const instrumented = () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    return taskDefinition
  }

  test('an uninstrumented task definition is not up to date', () => {
    const original = {...stripReadOnlyFields(fargateTaskDefinition()), tags: []}

    expect(isUpToDate(original, instrumented())).toBe(false)
  })

  test('an instrumented task definition is up to date', () => {
    const updated = instrumented()
    const original = {
      ...stripReadOnlyFields(fargateTaskDefinition({containerDefinitions: updated.containerDefinitions})),
      tags: INSTRUMENTATION_TAGS,
    }

    expect(isUpToDate(original, updated)).toBe(true)
  })

  test('a stale CLI version tag alone does not warrant a new revision', () => {
    const updated = instrumented()
    const original = {
      ...stripReadOnlyFields(fargateTaskDefinition({containerDefinitions: updated.containerDefinitions})),
      tags: [SERVICE_TAG, {key: 'dd_sls_ci', value: 'v0.0.0'}],
    }

    expect(isUpToDate(original, updated)).toBe(true)
  })

  test('a service tag that no longer matches warrants a new revision', () => {
    const updated = instrumented()
    const original = {
      ...stripReadOnlyFields(fargateTaskDefinition({containerDefinitions: updated.containerDefinitions})),
      tags: [{key: 'service', value: 'old-name'}, CLI_VERSION_TAG],
    }

    expect(isUpToDate(original, updated)).toBe(false)
  })
})
