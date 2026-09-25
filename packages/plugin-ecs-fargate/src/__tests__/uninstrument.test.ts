jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

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
import {mockClient} from 'aws-sdk-client-mock'

import {PluginCommand} from '../commands/uninstrument'
import {AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME} from '../constants'

import {
  APP_CONTAINER,
  INSTRUMENTATION_TAGS,
  MOCK_API_KEY,
  MOCK_CLUSTER,
  MOCK_FAMILY,
  MOCK_LOG_COLLECTION_SETTINGS,
  MOCK_REGION,
  MOCK_SERVICE,
  MOCK_SETTINGS,
  fargateService,
  fargateTaskDefinition,
  instrumentedTaskDefinition,
  serviceArn,
  taskDefinitionArn,
} from './fixtures'

const ecsMock = mockClient(ECSClient)

const runCLI = makeRunCLI(PluginCommand, [
  'ecs-fargate',
  'uninstrument',
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

/** Has `DescribeTaskDefinition` return an instrumented revision, which is what a run reverts. */
const describeInstrumented = (settings = MOCK_SETTINGS, original = fargateTaskDefinition()) =>
  ecsMock.on(DescribeTaskDefinitionCommand).resolves({
    taskDefinition: instrumentedTaskDefinition(settings, original),
    tags: INSTRUMENTATION_TAGS,
  })

describe('ecs-fargate uninstrument', () => {
  beforeEach(() => {
    ecsMock.reset()
    describeInstrumented()
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition({revision: 2})})
    ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService()], failures: []})
    ecsMock.on(UpdateServiceCommand).resolves({})
    promptInput.mockClear()
    fromIni
      .mockClear()
      .mockImplementation(() => () => Promise.resolve({accessKeyId: 'access-key', secretAccessKey: 'secret-key'}))
  })

  test('registers a new revision without the Agent sidecar', async () => {
    const {code, context} = await runCLI([])

    expect(code).toBe(0)
    const registerCalls = ecsMock.commandCalls(RegisterTaskDefinitionCommand)
    expect(registerCalls).toHaveLength(1)
    expect(registerCalls[0].args[0].input.containerDefinitions?.map((container) => container.name)).toStrictEqual([
      APP_CONTAINER.name,
    ])
    expect(context.stdout.toString()).toContain('Registered my-app:2')
  })

  test('removes the log router sidecar too', async () => {
    describeInstrumented(MOCK_LOG_COLLECTION_SETTINGS)

    const {code} = await runCLI([])

    expect(code).toBe(0)
    const names = registeredContainers().map((container) => container.name)
    expect(names).not.toContain(AGENT_CONTAINER_NAME)
    expect(names).not.toContain(LOG_ROUTER_CONTAINER_NAME)
  })

  test('describes the task definition including its tags', async () => {
    await runCLI([])

    expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)[0].args[0].input).toStrictEqual({
      taskDefinition: 'my-app',
      include: ['TAGS'],
    })
  })

  test('strips the environment the tracers read from the application containers', async () => {
    const {code} = await runCLI([])

    expect(code).toBe(0)
    expect(envVarsOf(registeredContainers(), APP_CONTAINER.name!)).toStrictEqual({PORT: '8080'})
  })

  test('removes the socket volume', async () => {
    const {code} = await runCLI([])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input.volumes).toStrictEqual([])
  })

  test('removes the instrumentation tags from the new revision', async () => {
    await runCLI([])

    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input.tags).toStrictEqual([])
  })

  test('registers nothing on a dry run, and shows what it would change', async () => {
    const {code, context} = await runCLI(['--dry-run'])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    const output = context.stdout.toString()
    expect(output).toContain('[Dry Run]')
    expect(output).toContain('Uninstrumenting my-app')
    expect(output).toContain(AGENT_CONTAINER_NAME)
    expect(output).toMatchSnapshot()
  })

  test('registers nothing for a task definition that is not instrumented', async () => {
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition(), tags: []})

    const {code, context} = await runCLI([])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    expect(context.stdout.toString()).toContain('my-app is not instrumented, no changes needed.')
  })

  test('registers a clean revision when only the CLI version tag is left behind', async () => {
    ecsMock
      .on(DescribeTaskDefinitionCommand)
      .resolves({taskDefinition: fargateTaskDefinition(), tags: [{key: 'dd_sls_ci', value: 'vXXXX'}]})

    const {code} = await runCLI([])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input.tags).toStrictEqual([])
  })

  test('warns that a log configuration routed through the log router cannot be put back', async () => {
    describeInstrumented(MOCK_LOG_COLLECTION_SETTINGS)

    const {code, context} = await runCLI([])

    expect(code).toBe(0)
    expect(context.stdout.toString()).toContain('cannot be restored')
  })

  test('keeps a plaintext API key out of the diff it prints', async () => {
    describeInstrumented({site: 'datadoghq.com', apiKey: MOCK_API_KEY})

    const {code, context} = await runCLI(['--dry-run'])

    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain('DD_API_KEY')
    expect(output).not.toContain(MOCK_API_KEY)
  })

  describe('configuration', () => {
    test('removes the environment variables it is given', async () => {
      const original = fargateTaskDefinition({
        containerDefinitions: [{...APP_CONTAINER, environment: [{name: 'CUSTOM_VAR', value: 'value'}]}],
      })
      describeInstrumented(MOCK_SETTINGS, original)

      const {code} = await runCLI(['--env-vars', 'CUSTOM_VAR=value'])

      expect(code).toBe(0)
      expect(envVarsOf(registeredContainers(), APP_CONTAINER.name!)).toStrictEqual({})
    })

    test('reports env vars that are not assignments', async () => {
      const {code, context} = await runCLI(['--env-vars', 'NOT_AN_ASSIGNMENT'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('All env vars must be in the format `KEY=VALUE`')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('reads the task definitions from the configuration file', async () => {
      const runWithConfig = makeRunCLI(PluginCommand, ['ecs-fargate', 'uninstrument', '-r', MOCK_REGION])

      const {code} = await runWithConfig(['--config', `${__dirname}/config/datadog-ci.json`])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)[0].args[0].input).toMatchObject({
        taskDefinition: 'my-app',
      })
    })

    test('reports a configuration file it cannot read', async () => {
      const {code, context} = await runCLI(['--config', `${__dirname}/config/does-not-exist.json`])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Could not read the configuration file: Config file not found')
    })

    test('reports no task definitions to act on', async () => {
      const runWithoutTarget = makeRunCLI(PluginCommand, ['ecs-fargate', 'uninstrument', '-r', MOCK_REGION])

      const {code, context} = await runWithoutTarget([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No task definitions specified. Use --task-definition.')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('reports task definitions that resolve to the same family', async () => {
      const {code, context} = await runCLI(['--task-definition', 'my-app:3'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain(
        '--task-definition names the same task definition family more than once (my-app)'
      )
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('accepts no instrument-only flag', async () => {
      const {code, context} = await runCLI(['--log-collection'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Unsupported option name')
    })

    test('fails when no region can be resolved', async () => {
      const runWithoutRegion = makeRunCLI(PluginCommand, ['ecs-fargate', 'uninstrument', '--task-definition', 'my-app'])

      const {code, context} = await runWithoutRegion([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No region specified')
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })

    test('resolves the region from the environment', async () => {
      const runWithoutRegion = makeRunCLI(PluginCommand, ['ecs-fargate', 'uninstrument', '--task-definition', 'my-app'])

      const {code} = await runWithoutRegion([], {AWS_REGION: MOCK_REGION})

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(1)
    })

    test('uses the named AWS profile it is given', async () => {
      await runCLI(['--profile', 'my-profile'])

      expect(fromIni).toHaveBeenCalledWith(expect.objectContaining({profile: 'my-profile'}))
    })

    test('asks for a code when the named profile is backed by MFA', async () => {
      await runCLI(['--profile', 'my-profile'])

      const {mfaCodeProvider} = fromIni.mock.calls[0][0] as FromIniInit
      expect(mfaCodeProvider).toBeDefined()
      await mfaCodeProvider?.('arn:aws:iam::123456789012:mfa/someone')
      expect(promptInput).toHaveBeenCalledWith(
        expect.objectContaining({message: expect.stringContaining('arn:aws:iam::123456789012:mfa/someone')})
      )
    })

    test('reports a named profile it cannot read', async () => {
      fromIni.mockImplementation(() => () => Promise.reject(new Error('Profile `my-profile` could not be found')))

      const {code, context} = await runCLI(['--profile', 'my-profile'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain("Couldn't get AWS profile credentials")
      expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
    })
  })

  describe('deployment', () => {
    test('points the service it is given at the new revision', async () => {
      const {code, context} = await runCLI(['--ecs-service', MOCK_SERVICE])

      expect(code).toBe(0)
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
      const {code} = await runCLI(['--ecs-service', MOCK_SERVICE, '--cluster', MOCK_CLUSTER])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(DescribeServicesCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
    })

    test('takes the cluster from the service ARN when it is not given one', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({services: [fargateService({serviceName: serviceArn()})]})

      const {code} = await runCLI(['--ecs-service', serviceArn()])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)[0].args[0].input).toMatchObject({cluster: MOCK_CLUSTER})
    })

    test('reports a cluster given without a service to update', async () => {
      const {code, context} = await runCLI(['--cluster', MOCK_CLUSTER])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('--cluster names the cluster of the services to update')
    })

    test('updates no service on a dry run', async () => {
      const {code, context} = await runCLI(['--ecs-service', MOCK_SERVICE, '--dry-run'])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(`[Dry Run] Updating ${MOCK_SERVICE} to the new my-app revision.`)
    })

    test('leaves a service that already runs an uninstrumented revision alone', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition(), tags: []})

      const {code, context} = await runCLI(['--ecs-service', MOCK_SERVICE])

      expect(code).toBe(0)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(`${MOCK_SERVICE} already runs my-app:1, no deployment needed.`)
    })

    test('reports a service running a task definition the run does not uninstrument', async () => {
      ecsMock
        .on(DescribeServicesCommand)
        .resolves({services: [fargateService({taskDefinition: taskDefinitionArn('other-app', 3)})]})

      const {code, context} = await runCLI(['--ecs-service', MOCK_SERVICE])

      expect(code).toBe(1)
      expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0)
      expect(context.stdout.toString()).toContain(
        `${MOCK_SERVICE} runs other-app, which this run does not uninstrument. Pass --task-definition other-app`
      )
    })

    test('tells you to roll out a task definition no service covers', async () => {
      const {code, context} = await runCLI([])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain(
        'Registered my-app:2. Update your services and tasks to this revision'
      )
    })

    test('reports a failure to update the service', async () => {
      ecsMock.on(UpdateServiceCommand).rejects(new Error('AccessDeniedException'))

      const {code, context} = await runCLI(['--ecs-service', MOCK_SERVICE])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('AccessDeniedException')
    })
  })

  describe('failures', () => {
    test('reports a task definition it cannot describe', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).rejects(new Error('ClientException'))

      const {code, context} = await runCLI([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('ClientException')
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    })

    test('reports a revision it cannot register', async () => {
      ecsMock.on(RegisterTaskDefinitionCommand).rejects(new Error('AccessDeniedException'))

      const {code, context} = await runCLI([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('AccessDeniedException')
    })

    test('reverts the task definitions that worked when another could not be described', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand, {taskDefinition: 'my-app'}).rejects(new Error('ClientException'))
      ecsMock.on(DescribeTaskDefinitionCommand, {taskDefinition: 'my-worker'}).resolves({
        taskDefinition: instrumentedTaskDefinition(MOCK_SETTINGS, fargateTaskDefinition({family: 'my-worker'})),
        tags: INSTRUMENTATION_TAGS,
      })
      ecsMock
        .on(RegisterTaskDefinitionCommand, {family: 'my-worker'})
        .resolves({taskDefinition: fargateTaskDefinition({family: 'my-worker', revision: 5})})

      const {code, context} = await runCLI(['--task-definition', 'my-worker'])

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('ClientException')
      expect(output).toContain('Registered my-worker:5')
      expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(1)
    })
  })
})
