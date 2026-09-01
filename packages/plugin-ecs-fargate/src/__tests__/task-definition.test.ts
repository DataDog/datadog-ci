import type {ContainerDefinition} from '@aws-sdk/client-ecs'

import {AGENT_IMAGE} from '@datadog/datadog-ci-base/helpers/serverless/constants'

import {AGENT_CONTAINER_NAME} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields, withMaskedApiKey} from '../task-definition'

import {
  APP_CONTAINER,
  INSTRUMENTATION_TAGS,
  MOCK_API_KEY,
  MOCK_API_KEY_SECRET_ARN,
  MOCK_SETTINGS,
  SOCKET_MOUNT,
  SOCKET_VOLUME,
  asDescribed,
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
      DD_DOGSTATSD_ORIGIN_DETECTION: 'true',
      DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT: 'true',
      DD_DOGSTATSD_TAG_CARDINALITY: 'orchestrator',
      ECS_FARGATE: 'true',
      DD_SITE: 'datadoghq.com',
      DD_APM_ENABLED: 'true',
      DD_USE_DOGSTATSD: 'true',
      DD_ECS_TASK_COLLECTION_ENABLED: 'true',
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
        {name: 'DD_TRACE_ENABLED', value: 'true'},
        {name: 'DD_LOGS_INJECTION', value: 'true'},
        {name: 'DD_TRACE_AGENT_URL', value: 'unix:///var/run/datadog/apm.socket'},
        {name: 'DD_DOGSTATSD_URL', value: 'unix:///var/run/datadog/dsd.socket'},
      ],
      mountPoints: [SOCKET_MOUNT],
    })
  })

  test('references the API key secret rather than writing the key', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(agent?.secrets).toStrictEqual([{name: 'DD_API_KEY', valueFrom: MOCK_API_KEY_SECRET_ARN}])
    expect(envVarsOf(agent)).not.toHaveProperty('DD_API_KEY')
  })

  test('rejects the secret reference when no execution role can read it', () => {
    const original = fargateTaskDefinition({executionRoleArn: undefined})

    expect(() => instrumentTaskDefinition(original, MOCK_SETTINGS)).toThrow(
      `Task definition my-app has no executionRoleArn, which ECS needs to read ${MOCK_API_KEY_SECRET_ARN}`
    )
  })

  test('accepts a task definition without an execution role when the API key is written in plain text', () => {
    const original = fargateTaskDefinition({executionRoleArn: undefined})

    expect(() =>
      instrumentTaskDefinition(original, {
        site: 'datadoghq.com',
        apiKey: MOCK_API_KEY,
      })
    ).not.toThrow()
  })

  test('writes the API key in plain text when no secret ARN is given', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      site: 'datadoghq.com',
      apiKey: MOCK_API_KEY,
    })

    const agent = agentContainerOf(taskDefinition.containerDefinitions)
    expect(envVarsOf(agent)).toHaveProperty('DD_API_KEY', MOCK_API_KEY)
    expect(agent?.secrets).toBeUndefined()
  })

  test('names the task role permissions ECS task collection needs when there is no task role', () => {
    const original = fargateTaskDefinition({taskRoleArn: undefined})

    const {warnings} = instrumentTaskDefinition(original, MOCK_SETTINGS)

    expect(warnings).toContainEqual(
      expect.stringContaining(
        'no taskRoleArn, so the Agent cannot collect ECS task metadata. Give the task definition a task role granting ecs:ListClusters, ecs:ListContainerInstances, ecs:DescribeContainerInstances'
      )
    )
  })

  test('keeps the DogStatsD origin tagging a task definition already chose', () => {
    const original = fargateTaskDefinition({
      containerDefinitions: [
        {...APP_CONTAINER},
        {name: AGENT_CONTAINER_NAME, environment: [{name: 'DD_DOGSTATSD_TAG_CARDINALITY', value: 'low'}]},
      ],
    })

    const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

    expect(envVarsOf(agentContainerOf(taskDefinition.containerDefinitions))).toMatchObject({
      DD_DOGSTATSD_TAG_CARDINALITY: 'low',
      DD_DOGSTATSD_ORIGIN_DETECTION: 'true',
    })
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

  describe('tags', () => {
    test('carries the existing tags onto the new revision', () => {
      const tags = [{key: 'team', value: 'intake'}]

      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, tags)

      expect(taskDefinition.tags).toStrictEqual([...tags, ...INSTRUMENTATION_TAGS])
    })

    test('tags the new revision with the CLI version', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, [])

      expect(taskDefinition.tags).toStrictEqual(INSTRUMENTATION_TAGS)
    })

    test('replaces the tags an earlier run left behind', () => {
      const tags = [
        {key: 'team', value: 'intake'},
        {key: 'dd_sls_ci', value: 'v0.0.0'},
      ]

      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS, tags)

      expect(taskDefinition.tags).toStrictEqual([{key: 'team', value: 'intake'}, ...INSTRUMENTATION_TAGS])
    })
  })

  describe('idempotency', () => {
    test('re-instrumenting produces an identical task definition', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      const second = instrumentTaskDefinition(asDescribed(first.taskDefinition, {revision: 2}), MOCK_SETTINGS)

      expect(second.taskDefinition).toStrictEqual(first.taskDefinition)
      expect(second.warnings).toHaveLength(0)
    })

    test('an already instrumented task definition is unchanged by the transform', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
      const described = asDescribed(first.taskDefinition)

      const {taskDefinition} = instrumentTaskDefinition(described, MOCK_SETTINGS)

      expect(taskDefinition).toStrictEqual({...stripReadOnlyFields(described), tags: INSTRUMENTATION_TAGS})
    })

    test('does not add a second Agent container', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      const {taskDefinition} = instrumentTaskDefinition(asDescribed(first.taskDefinition), MOCK_SETTINGS)

      expect(
        taskDefinition.containerDefinitions?.filter((container) => container.name === AGENT_CONTAINER_NAME)
      ).toHaveLength(1)
    })

    test('does not mount the socket volume twice', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      const {taskDefinition} = instrumentTaskDefinition(asDescribed(first.taskDefinition), MOCK_SETTINGS)

      expect(taskDefinition.volumes).toStrictEqual([SOCKET_VOLUME])
      expect(appContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toStrictEqual([SOCKET_MOUNT])
      expect(agentContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toStrictEqual([SOCKET_MOUNT])
    })
  })

  describe('reaching the Agent', () => {
    test('shares the socket volume between the Agent and the application containers', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      expect(taskDefinition.volumes).toStrictEqual([SOCKET_VOLUME])
      expect(agentContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toStrictEqual([SOCKET_MOUNT])
      expect(appContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toStrictEqual([SOCKET_MOUNT])
    })

    test('sends the tracers to the loopback address when the socket is turned off', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        agentSocket: false,
      })

      const app = appContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(app)).toMatchObject({DD_AGENT_HOST: '127.0.0.1'})
      expect(envVarsOf(app)).not.toHaveProperty('DD_TRACE_AGENT_URL')
      expect(envVarsOf(app)).not.toHaveProperty('DD_DOGSTATSD_URL')
      expect(taskDefinition.volumes).toStrictEqual([])
      expect(app?.mountPoints).toBeUndefined()
      expect(agentContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toBeUndefined()
    })

    // The two transports are mutually exclusive, so a socket URL left behind by an earlier run would
    // point the tracers at a path nothing is listening on.
    test('takes the socket away when an instrumented task definition turns it off', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      const {taskDefinition} = instrumentTaskDefinition(asDescribed(first.taskDefinition), {
        ...MOCK_SETTINGS,
        agentSocket: false,
      })

      const app = appContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(app)).not.toHaveProperty('DD_TRACE_AGENT_URL')
      expect(envVarsOf(app)).not.toHaveProperty('DD_DOGSTATSD_URL')
      expect(envVarsOf(app)).toMatchObject({DD_AGENT_HOST: '127.0.0.1'})
      expect(taskDefinition.volumes).toStrictEqual([])
      expect(app?.mountPoints).toStrictEqual([])
    })

    test('takes the loopback address away when the socket is turned back on', () => {
      const withoutSocket = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_SETTINGS,
        agentSocket: false,
      })

      const {taskDefinition} = instrumentTaskDefinition(asDescribed(withoutSocket.taskDefinition), MOCK_SETTINGS)

      const app = appContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(app)).not.toHaveProperty('DD_AGENT_HOST')
      expect(envVarsOf(app)).toMatchObject({
        DD_TRACE_AGENT_URL: 'unix:///var/run/datadog/apm.socket',
        DD_DOGSTATSD_URL: 'unix:///var/run/datadog/dsd.socket',
      })
      expect(taskDefinition.volumes).toStrictEqual([SOCKET_VOLUME])
    })

    test('keeps the volumes and mounts the task definition already declares', () => {
      const scratch = {name: 'scratch'}
      const scratchMount = {sourceVolume: 'scratch', containerPath: '/scratch', readOnly: false}
      const original = fargateTaskDefinition({
        volumes: [scratch],
        containerDefinitions: [{...APP_CONTAINER, mountPoints: [scratchMount]}],
      })

      const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

      expect(taskDefinition.volumes).toStrictEqual([scratch, SOCKET_VOLUME])
      expect(appContainerOf(taskDefinition.containerDefinitions)?.mountPoints).toStrictEqual([
        scratchMount,
        SOCKET_MOUNT,
      ])
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

describe('withMaskedApiKey', () => {
  test('masks the plaintext API key', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      site: 'datadoghq.com',
      apiKey: MOCK_API_KEY,
    })

    const masked = withMaskedApiKey(taskDefinition)

    const value = envVarsOf(agentContainerOf(masked.containerDefinitions)).DD_API_KEY
    expect(value).not.toBe(MOCK_API_KEY)
    expect(value).not.toContain(MOCK_API_KEY.slice(2, -4))
    expect(JSON.stringify(masked)).not.toContain(MOCK_API_KEY)
  })

  test('masks an API key that looks like a number', () => {
    const numericKey = '12345678901234567890123456789012'
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      site: 'datadoghq.com',
      apiKey: numericKey,
    })

    expect(JSON.stringify(withMaskedApiKey(taskDefinition))).not.toContain(numericKey)
  })

  test('leaves a task definition without a plaintext API key alone', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

    expect(withMaskedApiKey(taskDefinition)).toStrictEqual(taskDefinition)
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
    const original = {...stripReadOnlyFields(asDescribed(updated)), tags: INSTRUMENTATION_TAGS}

    expect(isUpToDate(original, updated)).toBe(true)
  })

  test('a stale CLI version tag alone does not warrant a new revision', () => {
    const updated = instrumented()
    const original = {...stripReadOnlyFields(asDescribed(updated)), tags: [{key: 'dd_sls_ci', value: 'v0.0.0'}]}

    expect(isUpToDate(original, updated)).toBe(true)
  })

  test('turning the socket off warrants a new revision', () => {
    const original = {...stripReadOnlyFields(asDescribed(instrumented())), tags: INSTRUMENTATION_TAGS}
    const {taskDefinition: updated} = instrumentTaskDefinition(fargateTaskDefinition(), {
      ...MOCK_SETTINGS,
      agentSocket: false,
    })

    expect(isUpToDate(original, updated)).toBe(false)
  })
})
