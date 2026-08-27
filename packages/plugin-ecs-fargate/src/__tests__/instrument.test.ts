jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const validateApiKey = jest.fn()
jest.mock('@datadog/datadog-ci-base/helpers/apikey', () => ({
  newApiKeyValidator: jest.fn().mockImplementation(() => ({
    validateApiKey,
  })),
}))

const fromIni = jest.fn()
jest.mock('@aws-sdk/credential-providers', () => ({
  fromIni,
  fromNodeProviderChain: jest.fn(
    () => () => Promise.resolve({accessKeyId: 'access-key', secretAccessKey: 'secret-key'})
  ),
}))

const promptInput = jest.fn().mockResolvedValue('123456')
jest.mock('@inquirer/prompts', () => ({input: promptInput}))

import type {ContainerDefinition} from '@aws-sdk/client-ecs'
import type {FromIniInit} from '@aws-sdk/credential-provider-ini'

import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {AGENT_IMAGE} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {mockClient} from 'aws-sdk-client-mock'

import {PluginCommand} from '../commands/instrument'
import {AGENT_CONTAINER_NAME} from '../constants'
import {instrumentTaskDefinition} from '../task-definition'

import {
  INSTRUMENTATION_TAGS,
  MOCK_API_KEY,
  MOCK_API_KEY_SECRET_ARN,
  MOCK_CLUSTER,
  MOCK_FAMILY,
  MOCK_REGION,
  MOCK_SERVICE,
  MOCK_SETTINGS,
  SOCKET_MOUNT,
  SOCKET_VOLUME,
  asDescribed,
  fargateService,
  fargateTaskDefinition,
  serviceArn,
  taskDefinitionArn,
} from './fixtures'

const ecsMock = mockClient(ECSClient)

const runCLI = makeRunCLI(PluginCommand, [
  'ecs-fargate',
  'instrument',
  '--task-definition',
  'my-app',
  '-r',
  MOCK_REGION,
])

const registeredContainers = (call = 0): ContainerDefinition[] =>
  ecsMock.commandCalls(RegisterTaskDefinitionCommand)[call].args[0].input.containerDefinitions ?? []

const envVarsOf = (containers: ContainerDefinition[], name: string) =>
  Object.fromEntries(
    (containers.find((container) => container.name === name)?.environment ?? []).map(({name: key, value}) => [
      key,
      value,
    ])
  )

describe('ecs-fargate instrument', () => {
  beforeEach(() => {
    ecsMock.reset()
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition(), tags: []})
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition({revision: 2})})
    ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService()], failures: []})
    ecsMock.on(UpdateServiceCommand).resolves({})
    validateApiKey.mockClear().mockResolvedValue(true)
    promptInput.mockClear()
    fromIni
      .mockClear()
      .mockImplementation(() => () => Promise.resolve({accessKeyId: 'access-key', secretAccessKey: 'secret-key'}))
  })

  test('registers a new revision with the Agent sidecar', async () => {
    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(code).toBe(0)
    const registerCalls = ecsMock.commandCalls(RegisterTaskDefinitionCommand)
    expect(registerCalls).toHaveLength(1)
    expect(registerCalls[0].args[0].input.containerDefinitions?.map((container) => container.name)).toStrictEqual([
      'my-app',
      AGENT_CONTAINER_NAME,
    ])
    expect(context.stdout.toString()).toContain('Registered my-app:2')
  })

  test('describes the task definition including its tags', async () => {
    await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)[0].args[0].input).toStrictEqual({
      taskDefinition: 'my-app',
      include: ['TAGS'],
    })
  })

  test('prints the diff and registers nothing on a dry run', async () => {
    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--dry-run'])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    const output = context.stdout.toString()
    expect(output).toContain('[Dry Run]')
    expect(output).toContain('Instrumenting my-app')
    expect(output).toContain(AGENT_CONTAINER_NAME)
    expect(output).toMatchSnapshot()
  })

  test('tags the new revision with the CLI version', async () => {
    await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    const registered = ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input
    expect(registered.tags).toStrictEqual(INSTRUMENTATION_TAGS)
  })

  test('registers nothing when only the CLI version tag is out of date', async () => {
    const {taskDefinition: instrumented} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: asDescribed(instrumented),
      tags: [{key: 'dd_sls_ci', value: 'v0.0.0'}],
    })

    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    expect(context.stdout.toString()).toContain('my-app is already instrumented')
  })

  test('registers nothing when the task definition is already instrumented', async () => {
    const {taskDefinition: instrumented} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: asDescribed(instrumented),
      tags: INSTRUMENTATION_TAGS,
    })

    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    expect(context.stdout.toString()).toContain('my-app is already instrumented')
  })

  test('instruments every task definition it is given', async () => {
    const {code} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--task-definition', 'my-other-app'])

    expect(code).toBe(0)
    expect(
      ecsMock.commandCalls(DescribeTaskDefinitionCommand).map((call) => call.args[0].input.taskDefinition)
    ).toStrictEqual(['my-app', 'my-other-app'])
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(2)
  })

  test('keeps instrumenting after a task definition it cannot handle', async () => {
    ecsMock
      .on(DescribeTaskDefinitionCommand, {taskDefinition: 'my-app'})
      .resolves({taskDefinition: fargateTaskDefinition({networkMode: 'bridge'}), tags: []})

    const {code, context} = await runCLI([
      '--api-key-secret-arn',
      MOCK_API_KEY_SECRET_ARN,
      '--task-definition',
      'my-other-app',
    ])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Fargate requires awsvpc')
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(1)
  })

  describe('configuration', () => {
    test('runs the Agent image it is given', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--agent-image', 'my-registry/agent:7.60.0'])

      const agent = registeredContainers().find((container) => container.name === AGENT_CONTAINER_NAME)
      expect(agent?.image).toBe('my-registry/agent:7.60.0')
    })

    test('runs the default Agent image when it is given none', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      const agent = registeredContainers().find((container) => container.name === AGENT_CONTAINER_NAME)
      expect(agent?.image).toBe(AGENT_IMAGE)
    })

    test('shares the socket volume with every container by default', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      const registered = ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input
      expect(registered.volumes).toStrictEqual([SOCKET_VOLUME])
      for (const container of registered.containerDefinitions ?? []) {
        expect(container.mountPoints).toContainEqual(SOCKET_MOUNT)
      }
      expect(envVarsOf(registeredContainers(), MOCK_FAMILY)).toMatchObject({
        DD_TRACE_AGENT_URL: 'unix:///var/run/datadog/apm.socket',
        DD_DOGSTATSD_URL: 'unix:///var/run/datadog/dsd.socket',
      })
    })

    test('leaves the socket off when told to', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--no-agent-socket'])

      const registered = ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input
      expect(registered.volumes).toStrictEqual([])
      for (const container of registered.containerDefinitions ?? []) {
        expect(container.mountPoints).toBeUndefined()
      }
      expect(envVarsOf(registeredContainers(), MOCK_FAMILY)).toMatchObject({DD_AGENT_HOST: '127.0.0.1'})
    })

    test('reads the task definitions and their configuration from a config file', async () => {
      const runWithConfig = makeRunCLI(PluginCommand, ['ecs-fargate', 'instrument', '-r', MOCK_REGION])

      const {code} = await runWithConfig([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--config',
        `${__dirname}/config/datadog-ci.json`,
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)[0].args[0].input.taskDefinition).toBe('my-app')
      expect(registeredContainers().find((container) => container.name === AGENT_CONTAINER_NAME)?.image).toBe(
        'public.ecr.aws/datadog/agent:7-from-config'
      )
      // Leaving --no-agent-socket off does not override the choice the file made.
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input.volumes).toStrictEqual([])
    })

    test('prefers a command-line argument over the configuration file', async () => {
      const runWithConfig = makeRunCLI(PluginCommand, ['ecs-fargate', 'instrument', '-r', MOCK_REGION])

      const {code} = await runWithConfig([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--config',
        `${__dirname}/config/datadog-ci.json`,
        '--agent-image',
        'my-registry/agent:7.60.0',
      ])

      expect(code).toBe(0)
      expect(registeredContainers().find((container) => container.name === AGENT_CONTAINER_NAME)?.image).toBe(
        'my-registry/agent:7.60.0'
      )
    })

    test('reports a configuration file it cannot read', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--config',
        `${__dirname}/config/does-not-exist.json`,
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Could not read the configuration file: Config file not found')
    })

    test('reports every problem with the configuration at once', async () => {
      const runWithoutTarget = makeRunCLI(PluginCommand, ['ecs-fargate', 'instrument', '-r', MOCK_REGION])

      const {code, context} = await runWithoutTarget([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--cluster',
        MOCK_CLUSTER,
      ])

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('No task definitions specified to instrument')
      expect(output).toContain('--cluster names the cluster of the services to update')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('reports task definitions that resolve to the same family', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--task-definition',
        'my-app:3',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain(
        '--task-definition names the same task definition family more than once (my-app)'
      )
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('accepts task definitions of different families named in different formats', async () => {
      const {code} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--task-definition',
        taskDefinitionArn('my-worker', 4),
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(2)
    })

    test('reports a cluster given without a service to update', async () => {
      const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--cluster', MOCK_CLUSTER])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('--cluster names the cluster of the services to update')
    })

    test('uses the named AWS profile it is given', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--profile', 'my-profile'])

      expect(fromIni).toHaveBeenCalledWith(expect.objectContaining({profile: 'my-profile'}))
    })

    test('asks for a code when the named profile is backed by MFA', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--profile', 'my-profile'])

      const {mfaCodeProvider} = fromIni.mock.calls[0][0] as FromIniInit
      expect(mfaCodeProvider).toBeDefined()
      await mfaCodeProvider?.('arn:aws:iam::123456789012:mfa/someone')
      expect(promptInput).toHaveBeenCalledWith(
        expect.objectContaining({message: expect.stringContaining('arn:aws:iam::123456789012:mfa/someone')})
      )
    })

    test('reports a named profile it cannot read', async () => {
      fromIni.mockImplementation(() => () => Promise.reject(new Error('Profile `my-profile` could not be found')))

      const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--profile', 'my-profile'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain("Couldn't set AWS profile credentials")
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('fails when no region can be resolved', async () => {
      const runWithoutRegion = makeRunCLI(PluginCommand, ['ecs-fargate', 'instrument', '--task-definition', 'my-app'])

      const {code, context} = await runWithoutRegion(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No region specified')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('resolves the region from the environment', async () => {
      const runWithoutRegion = makeRunCLI(PluginCommand, ['ecs-fargate', 'instrument', '--task-definition', 'my-app'])

      const {code} = await runWithoutRegion(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN], {
        AWS_REGION: MOCK_REGION,
      })

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(1)
    })
  })

  describe('deployment', () => {
    test('points the service it is given at the new revision', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeServicesCommand)[0].args[0].input).toStrictEqual({
        cluster: undefined,
        services: [MOCK_SERVICE],
      })
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toStrictEqual({
        cluster: undefined,
        service: MOCK_SERVICE,
        taskDefinition: taskDefinitionArn(MOCK_FAMILY, 2),
      })
      const output = context.stdout.toString()
      expect(output).toContain(`Updating ${MOCK_SERVICE} to my-app:2`)
      expect(output).not.toContain('Update your services and tasks')
    })

    test('looks the service up in the cluster it is given', async () => {
      const {code} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
        '--cluster',
        MOCK_CLUSTER,
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeServicesCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
    })

    test('takes the cluster from the service ARN when it is not given one', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService({serviceName: serviceArn()})]})

      const {code} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--ecs-service', serviceArn()])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeServicesCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
    })

    test('keeps the cluster it is given when the service ARN agrees', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService({serviceName: serviceArn()})]})

      const {code} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        serviceArn(),
        '--cluster',
        MOCK_CLUSTER,
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
    })

    test('reports a cluster that the service ARN contradicts', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        serviceArn(MOCK_SERVICE, 'other-cluster'),
        '--cluster',
        MOCK_CLUSTER,
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain(
        `--cluster ${MOCK_CLUSTER} is not the cluster the service ARNs name (other-cluster).`
      )
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('reports service ARNs that name different clusters', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        serviceArn(MOCK_SERVICE, 'one'),
        '--ecs-service',
        serviceArn('my-worker-service', 'two'),
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('The service ARNs name several clusters (one, two)')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('leaves the cluster alone for a short-format service ARN', async () => {
      const shortFormat = `arn:aws:ecs:${MOCK_REGION}:123456789012:service/${MOCK_SERVICE}`
      ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService({serviceName: shortFormat})]})

      const {code} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--ecs-service', shortFormat])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: undefined})
    })

    test('points each service at the revision of the family it runs', async () => {
      ecsMock
        .on(DescribeTaskDefinitionCommand, {taskDefinition: 'my-worker'})
        .resolves({taskDefinition: fargateTaskDefinition({family: 'my-worker', revision: 4}), tags: []})
      ecsMock
        .on(RegisterTaskDefinitionCommand, {family: 'my-worker'})
        .resolves({taskDefinition: fargateTaskDefinition({family: 'my-worker', revision: 5})})
      ecsMock.on(DescribeServicesCommand, {services: ['my-worker-service']}).resolves({
        services: [
          fargateService({serviceName: 'my-worker-service', taskDefinition: taskDefinitionArn('my-worker', 4)}),
        ],
      })

      const {code} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--task-definition',
        'my-worker',
        '--ecs-service',
        MOCK_SERVICE,
        '--ecs-service',
        'my-worker-service',
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand).map((call) => call.args[0].input)).toStrictEqual([
        {cluster: undefined, service: MOCK_SERVICE, taskDefinition: taskDefinitionArn(MOCK_FAMILY, 2)},
        {cluster: undefined, service: 'my-worker-service', taskDefinition: taskDefinitionArn('my-worker', 5)},
      ])
    })

    test('leaves a service that already runs the instrumented revision alone', async () => {
      const {taskDefinition: instrumented} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({
        taskDefinition: asDescribed(instrumented),
        tags: INSTRUMENTATION_TAGS,
      })

      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(`${MOCK_SERVICE} already runs my-app:1, no deployment needed.`)
    })

    test('updates no service on a dry run', async () => {
      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
        '--dry-run',
      ])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(`[Dry Run] Updating ${MOCK_SERVICE} to the new my-app revision.`)
    })

    test('deploys nothing when a task definition could not be instrumented', async () => {
      ecsMock
        .on(DescribeTaskDefinitionCommand)
        .resolves({taskDefinition: fargateTaskDefinition({networkMode: 'bridge'}), tags: []})

      const {code} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN, '--ecs-service', MOCK_SERVICE])

      expect(code).toBe(1)
      expect(ecsMock.commandCalls(DescribeServicesCommand)).toHaveLength(0)
    })

    test('reports a service running a task definition it did not instrument', async () => {
      ecsMock
        .on(DescribeServicesCommand)
        .resolves({services: [fargateService({taskDefinition: taskDefinitionArn('other-app', 3)})]})

      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
      ])

      expect(code).toBe(1)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(
        `${MOCK_SERVICE} runs other-app, which this run did not instrument. Pass --task-definition other-app`
      )
    })

    test('keeps deploying after a service it cannot find', async () => {
      ecsMock.on(DescribeServicesCommand, {services: ['gone']}).resolves({
        services: [],
        failures: [{arn: 'arn:aws:ecs:us-east-1:123456789012:service/gone', reason: 'MISSING'}],
      })

      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        'gone',
        '--ecs-service',
        MOCK_SERVICE,
        '--cluster',
        MOCK_CLUSTER,
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain(
        `No ECS service found for gone (MISSING) in the ${MOCK_CLUSTER} cluster.`
      )
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(1)
    })

    test('reports a failure to update the service', async () => {
      ecsMock.on(UpdateServiceCommand).rejects(new Error('AccessDeniedException'))

      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('AccessDeniedException')
    })
  })

  describe('API key', () => {
    test('warns when the API key is written in plain text', async () => {
      const {code, context} = await runCLI([], {DATADOG_API_KEY: '', DD_API_KEY: MOCK_API_KEY})

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('in plain text')
      expect(envVarsOf(registeredContainers(), AGENT_CONTAINER_NAME)).toMatchObject({DD_API_KEY: MOCK_API_KEY})
    })

    test('keeps a plaintext API key out of the diff it prints', async () => {
      const {code, context} = await runCLI(['--dry-run'], {DATADOG_API_KEY: '', DD_API_KEY: MOCK_API_KEY})

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('DD_API_KEY')
      expect(output).not.toContain(MOCK_API_KEY)
    })

    test('fails when no API key is available', async () => {
      const {code, context} = await runCLI([], {DD_API_KEY: '', DATADOG_API_KEY: ''})

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No Datadog API key found')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('fails before instrumenting when the API key is invalid', async () => {
      validateApiKey.mockResolvedValue(false)

      const {code, context} = await runCLI([], {DATADOG_API_KEY: '', DD_API_KEY: MOCK_API_KEY})

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Invalid Datadog API key')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('does not validate a key it cannot read', async () => {
      await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      expect(validateApiKey).not.toHaveBeenCalled()
    })
  })

  describe('failures', () => {
    test('reports a task definition that cannot be instrumented', async () => {
      ecsMock
        .on(DescribeTaskDefinitionCommand)
        .resolves({taskDefinition: fargateTaskDefinition({networkMode: 'bridge'}), tags: []})

      const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Fargate requires awsvpc')
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    })

    test('registers and deploys nothing when no execution role can read the API key secret', async () => {
      ecsMock
        .on(DescribeTaskDefinitionCommand)
        .resolves({taskDefinition: fargateTaskDefinition({executionRoleArn: undefined}), tags: []})

      const {code, context} = await runCLI([
        '--api-key-secret-arn',
        MOCK_API_KEY_SECRET_ARN,
        '--ecs-service',
        MOCK_SERVICE,
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('has no executionRoleArn')
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
    })

    test('reports a task definition that does not exist', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({})

      const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No task definition found for my-app')
    })

    test('reports a failure to register the new revision', async () => {
      ecsMock.on(RegisterTaskDefinitionCommand).rejects(new Error('AccessDeniedException'))

      const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('AccessDeniedException')
    })
  })
})
