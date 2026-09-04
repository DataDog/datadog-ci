import type {ContainerDefinition, RuntimePlatform} from '@aws-sdk/client-ecs'

import {AGENT_IMAGE} from '@datadog/datadog-ci-base/helpers/serverless/constants'

import {AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields, withMaskedApiKey} from '../task-definition'

import {
  APP_CONTAINER,
  CLI_VERSION_TAG,
  FIRELENS_LOG_CONFIGURATION,
  INSTRUMENTATION_TAGS,
  LOG_ROUTER_CONTAINER,
  MOCK_API_KEY,
  MOCK_API_KEY_SECRET_ARN,
  MOCK_LOG_COLLECTION_SETTINGS,
  MOCK_SETTINGS,
  SERVICE_TAG,
  SOCKET_MOUNT,
  SOCKET_VOLUME,
  asDescribed,
  fargateTaskDefinition,
  firelensLogConfiguration,
  windowsTaskDefinition,
} from './fixtures'

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const agentContainerOf = (containers: ContainerDefinition[] | undefined) =>
  containers?.find((container) => container.name === AGENT_CONTAINER_NAME)

const logRouterContainerOf = (containers: ContainerDefinition[] | undefined) =>
  containers?.find((container) => container.name === LOG_ROUTER_CONTAINER_NAME)

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
        {name: 'DD_TRACE_AGENT_URL', value: 'unix:///var/run/datadog/apm.socket'},
        {name: 'DD_DOGSTATSD_URL', value: 'unix:///var/run/datadog/dsd.socket'},
      ],
      dockerLabels: {'com.datadoghq.tags.service': 'my-app'},
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

    describe('docker labels', () => {
      test('labels the application containers so the Agent tags what it collects about them', () => {
        const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
          ...MOCK_SETTINGS,
          service: 'payments',
          environment: 'prod',
          version: '1.0.0',
        })

        expect(appContainerOf(taskDefinition.containerDefinitions)?.dockerLabels).toStrictEqual({
          'com.datadoghq.tags.service': 'payments',
          'com.datadoghq.tags.env': 'prod',
          'com.datadoghq.tags.version': '1.0.0',
        })
      })

      test('leaves the Agent container unlabelled, so it does not report under the application service', () => {
        const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
          ...MOCK_SETTINGS,
          service: 'payments',
        })

        expect(agentContainerOf(taskDefinition.containerDefinitions)?.dockerLabels).toBeUndefined()
      })

      test('keeps a label the application container carried when the service is only inferred', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [{...APP_CONTAINER, dockerLabels: {'com.datadoghq.tags.service': 'checkout'}}],
        })

        const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

        expect(appContainerOf(taskDefinition.containerDefinitions)?.dockerLabels).toStrictEqual({
          'com.datadoghq.tags.service': 'checkout',
        })
      })

      test('overrides a label the container carried with an explicit service', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [{...APP_CONTAINER, dockerLabels: {'com.datadoghq.tags.service': 'checkout'}}],
        })

        const {taskDefinition} = instrumentTaskDefinition(original, {...MOCK_SETTINGS, service: 'payments'})

        expect(appContainerOf(taskDefinition.containerDefinitions)?.dockerLabels).toStrictEqual({
          'com.datadoghq.tags.service': 'payments',
        })
      })

      test('preserves labels that have nothing to do with Datadog', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [{...APP_CONTAINER, dockerLabels: {'com.example.team': 'intake'}}],
        })

        const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

        expect(appContainerOf(taskDefinition.containerDefinitions)?.dockerLabels).toStrictEqual({
          'com.example.team': 'intake',
          'com.datadoghq.tags.service': 'my-app',
        })
      })

      test('adds no labels when there is nothing to name the service after', () => {
        const original = {...fargateTaskDefinition(), family: undefined}

        const {taskDefinition} = instrumentTaskDefinition(original, MOCK_SETTINGS)

        // An empty map would read as a change against a task definition that had none, and register
        // a revision for nothing.
        expect(appContainerOf(taskDefinition.containerDefinitions)).not.toHaveProperty('dockerLabels')
      })
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

  describe('windows tasks', () => {
    test('runs the Windows build of the Agent image', () => {
      const {taskDefinition} = instrumentTaskDefinition(windowsTaskDefinition(), MOCK_SETTINGS)

      expect(agentContainerOf(taskDefinition.containerDefinitions)?.image).toBe(`${AGENT_IMAGE}-servercore`)
    })

    test('gives the Agent the working directory its Windows image leaves unset', () => {
      const {taskDefinition} = instrumentTaskDefinition(windowsTaskDefinition(), MOCK_SETTINGS)

      expect(agentContainerOf(taskDefinition.containerDefinitions)?.workingDirectory).toBe('C:\\')
    })

    test('adds no health check, since the Agent probe only ships in the Linux image', () => {
      const {taskDefinition, warnings} = instrumentTaskDefinition(windowsTaskDefinition(), MOCK_SETTINGS)

      expect(agentContainerOf(taskDefinition.containerDefinitions)).not.toHaveProperty('healthCheck')
      expect(warnings).toContainEqual(expect.stringContaining('without a health check'))
    })

    test('still runs an explicitly requested image', () => {
      const {taskDefinition} = instrumentTaskDefinition(windowsTaskDefinition(), {
        ...MOCK_SETTINGS,
        agentImage: 'my-registry/agent:7.60.0-servercore',
      })

      expect(agentContainerOf(taskDefinition.containerDefinitions)?.image).toBe('my-registry/agent:7.60.0-servercore')
    })

    test('instruments the application containers as it would on Linux', () => {
      const {taskDefinition} = instrumentTaskDefinition(windowsTaskDefinition(), {
        ...MOCK_SETTINGS,
        service: 'payments',
      })

      const app = appContainerOf(taskDefinition.containerDefinitions)
      expect(envVarsOf(app)).toHaveProperty('DD_SERVICE', 'payments')
      expect(app?.dockerLabels).toStrictEqual({'com.datadoghq.tags.service': 'payments'})
    })

    test('rejects log collection, since FireLens does not run on Windows', () => {
      expect(() => instrumentTaskDefinition(windowsTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)).toThrow(
        'the datadog-log-router sidecar does not support'
      )
    })

    test('re-instrumenting produces an identical task definition', () => {
      const first = instrumentTaskDefinition(windowsTaskDefinition(), MOCK_SETTINGS)
      const described = asDescribed(first.taskDefinition, {
        runtimePlatform: {operatingSystemFamily: 'WINDOWS_SERVER_2022_CORE', cpuArchitecture: 'X86_64'},
      })

      const second = instrumentTaskDefinition(described, MOCK_SETTINGS)

      expect(second.taskDefinition).toStrictEqual(first.taskDefinition)
    })

    test.each<[string, RuntimePlatform | undefined]>([
      ['LINUX', {operatingSystemFamily: 'LINUX', cpuArchitecture: 'X86_64'}],
      ['no runtime platform', undefined],
    ])('builds the Linux Agent for a task declaring %s', (_, runtimePlatform) => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition({runtimePlatform}), MOCK_SETTINGS)

      const agent = agentContainerOf(taskDefinition.containerDefinitions)
      expect(agent?.image).toBe(AGENT_IMAGE)
      expect(agent?.healthCheck).toBeDefined()
      expect(agent).not.toHaveProperty('workingDirectory')
    })
  })

  describe('log collection', () => {
    test('collects no logs unless it is asked to', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)

      expect(logRouterContainerOf(taskDefinition.containerDefinitions)).toBeUndefined()
      expect(appContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toStrictEqual(
        APP_CONTAINER.logConfiguration
      )
    })

    test('adds the log router sidecar', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      expect(logRouterContainerOf(taskDefinition.containerDefinitions)).toStrictEqual(LOG_ROUTER_CONTAINER)
    })

    test('routes the application containers and the Agent through the router', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      expect(appContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toStrictEqual(
        FIRELENS_LOG_CONFIGURATION
      )
      expect(agentContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toStrictEqual(
        FIRELENS_LOG_CONFIGURATION
      )
    })

    test('references the API key secret rather than writing the key into the log driver', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      const logConfiguration = appContainerOf(taskDefinition.containerDefinitions)?.logConfiguration
      expect(logConfiguration?.secretOptions).toStrictEqual([{name: 'apikey', valueFrom: MOCK_API_KEY_SECRET_ARN}])
      expect(logConfiguration?.options).not.toHaveProperty('apikey')
    })

    test('writes the API key into the log driver when no secret ARN is given', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        site: 'datadoghq.com',
        apiKey: MOCK_API_KEY,
        logCollection: true,
      })

      const logConfiguration = appContainerOf(taskDefinition.containerDefinitions)?.logConfiguration
      expect(logConfiguration).toStrictEqual(firelensLogConfiguration({plaintext: MOCK_API_KEY}))
      expect(logConfiguration?.secretOptions).toBeUndefined()
    })

    test('sends the logs to the intake of the site it is given', () => {
      const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
        ...MOCK_LOG_COLLECTION_SETTINGS,
        site: 'datadoghq.eu',
      })

      expect(appContainerOf(taskDefinition.containerDefinitions)?.logConfiguration?.options).toMatchObject({
        Host: 'http-intake.logs.datadoghq.eu',
      })
    })

    // The router cannot route its own logs, so a router that fails to start would take the task's
    // logs with it and leave nothing behind to say why.
    test('keeps a log configuration of its own on the router', () => {
      const {taskDefinition, warnings} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      expect(logRouterContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toStrictEqual(
        APP_CONTAINER.logConfiguration
      )
      expect(warnings).not.toContainEqual(expect.stringContaining('no logConfiguration'))
    })

    test('warns when there is no log configuration to give the router', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, logConfiguration: undefined}],
      })

      const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_LOG_COLLECTION_SETTINGS)

      expect(logRouterContainerOf(taskDefinition.containerDefinitions)?.logConfiguration).toBeUndefined()
      expect(warnings).toContainEqual(expect.stringContaining('datadog-log-router container has no logConfiguration'))
    })

    test('names the containers whose log configuration the router takes over', () => {
      const {warnings} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      expect(warnings).toStrictEqual([
        expect.stringContaining('Routing the logs of the my-app container through datadog-log-router, replacing the'),
      ])
    })

    test('says nothing about a container that declared no log configuration', () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, logConfiguration: undefined}],
      })

      const {warnings} = instrumentTaskDefinition(original, MOCK_LOG_COLLECTION_SETTINGS)

      expect(warnings).not.toContainEqual(expect.stringContaining('Routing the logs'))
    })

    test('gives the router none of what the application containers get', () => {
      const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

      const {taskDefinition} = instrumentTaskDefinition(asDescribed(first.taskDefinition), MOCK_LOG_COLLECTION_SETTINGS)

      const router = logRouterContainerOf(taskDefinition.containerDefinitions)
      expect(router?.environment).toBeUndefined()
      expect(router?.mountPoints).toBeUndefined()
      expect(router?.dockerLabels).toBeUndefined()
    })

    describe('idempotency', () => {
      test('re-instrumenting produces an identical task definition', () => {
        const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

        const second = instrumentTaskDefinition(
          asDescribed(first.taskDefinition, {revision: 2}),
          MOCK_LOG_COLLECTION_SETTINGS
        )

        expect(second.taskDefinition).toStrictEqual(first.taskDefinition)
        expect(second.warnings).toHaveLength(0)
      })

      test('does not add a second log router container', () => {
        const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

        const {taskDefinition} = instrumentTaskDefinition(
          asDescribed(first.taskDefinition),
          MOCK_LOG_COLLECTION_SETTINGS
        )

        expect(
          taskDefinition.containerDefinitions?.filter((container) => container.name === LOG_ROUTER_CONTAINER_NAME)
        ).toHaveLength(1)
      })

      test('turning log collection on warrants a new revision', () => {
        const original = {
          ...stripReadOnlyFields(
            asDescribed(instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS).taskDefinition)
          ),
          tags: INSTRUMENTATION_TAGS,
        }
        const {taskDefinition: updated} = instrumentTaskDefinition(
          fargateTaskDefinition(),
          MOCK_LOG_COLLECTION_SETTINGS
        )

        expect(isUpToDate(original, updated)).toBe(false)
      })

      // The command cannot put back the log configuration it replaced, so taking the router away
      // would leave the containers pointing at a router that is no longer there.
      test('leaves an instrumented task definition alone when log collection is turned back off', () => {
        const first = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

        const {taskDefinition, warnings} = instrumentTaskDefinition(asDescribed(first.taskDefinition), MOCK_SETTINGS)

        expect(taskDefinition).toStrictEqual(first.taskDefinition)
        expect(warnings).toHaveLength(0)
      })
    })

    describe('existing log router container', () => {
      test('preserves what the user added by hand', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [
            {...APP_CONTAINER},
            {
              name: LOG_ROUTER_CONTAINER_NAME,
              image: 'public.ecr.aws/aws-observability/aws-for-fluent-bit:2.32.0',
              memory: 128,
              environment: [{name: 'FLB_LOG_LEVEL', value: 'debug'}],
            },
          ],
        })

        const {taskDefinition} = instrumentTaskDefinition(original, MOCK_LOG_COLLECTION_SETTINGS)

        const router = logRouterContainerOf(taskDefinition.containerDefinitions)
        expect(router?.memory).toBe(128)
        expect(router?.environment).toStrictEqual([{name: 'FLB_LOG_LEVEL', value: 'debug'}])
        // The command owns the image.
        expect(router?.image).toBe(LOG_ROUTER_CONTAINER.image)
      })

      test('warns when it has to override an essential log router container', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [{...APP_CONTAINER}, {name: LOG_ROUTER_CONTAINER_NAME, essential: true}],
        })

        const {taskDefinition, warnings} = instrumentTaskDefinition(original, MOCK_LOG_COLLECTION_SETTINGS)

        expect(logRouterContainerOf(taskDefinition.containerDefinitions)?.essential).toBe(false)
        expect(warnings).toContainEqual(
          expect.stringContaining(`Marking the ${LOG_ROUTER_CONTAINER_NAME} container non-essential`)
        )
      })

      test('warns when it replaces a health check the user wrote', () => {
        const original = fargateTaskDefinition({
          containerDefinitions: [
            {...APP_CONTAINER},
            {name: LOG_ROUTER_CONTAINER_NAME, essential: false, healthCheck: {command: ['CMD-SHELL', 'exit 1']}},
          ],
        })

        const {warnings} = instrumentTaskDefinition(original, MOCK_LOG_COLLECTION_SETTINGS)

        expect(warnings).toContainEqual(expect.stringContaining('health check'))
      })
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

  test('masks the plaintext API key the log driver carries', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), {
      site: 'datadoghq.com',
      apiKey: MOCK_API_KEY,
      logCollection: true,
    })

    const masked = withMaskedApiKey(taskDefinition)

    const value = appContainerOf(masked.containerDefinitions)?.logConfiguration?.options?.apikey
    expect(value).toBeDefined()
    expect(value).not.toBe(MOCK_API_KEY)
    expect(JSON.stringify(masked)).not.toContain(MOCK_API_KEY)
  })

  test('leaves the secret reference in the log driver alone', () => {
    const {taskDefinition} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_LOG_COLLECTION_SETTINGS)

    expect(withMaskedApiKey(taskDefinition)).toStrictEqual(taskDefinition)
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
    const original = {
      ...stripReadOnlyFields(asDescribed(updated)),
      tags: [SERVICE_TAG, {key: 'dd_sls_ci', value: 'v0.0.0'}],
    }

    expect(isUpToDate(original, updated)).toBe(true)
  })

  test('a service tag that no longer matches warrants a new revision', () => {
    const updated = instrumented()
    const original = {
      ...stripReadOnlyFields(asDescribed(updated)),
      tags: [{key: 'service', value: 'old-name'}, CLI_VERSION_TAG],
    }

    expect(isUpToDate(original, updated)).toBe(false)
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
