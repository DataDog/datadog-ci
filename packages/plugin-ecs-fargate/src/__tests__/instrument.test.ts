import {DescribeTaskDefinitionCommand, ECSClient, RegisterTaskDefinitionCommand} from '@aws-sdk/client-ecs'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {mockClient} from 'aws-sdk-client-mock'

import {PluginCommand} from '../commands/instrument'
import {AGENT_CONTAINER_NAME} from '../constants'
import {instrumentTaskDefinition} from '../task-definition'

import {
  CLI_VERSION_TAG,
  MOCK_API_KEY,
  MOCK_API_KEY_SECRET_ARN,
  MOCK_REGION,
  MOCK_SETTINGS,
  fargateTaskDefinition,
} from './fixtures'

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

jest.mock('@aws-sdk/credential-providers', () => ({
  fromIni: jest.fn(() => () => Promise.resolve({accessKeyId: 'access-key', secretAccessKey: 'secret-key'})),
  fromNodeProviderChain: jest.fn(
    () => () => Promise.resolve({accessKeyId: 'access-key', secretAccessKey: 'secret-key'})
  ),
}))

const ecsMock = mockClient(ECSClient)

const runCLI = makeRunCLI(PluginCommand, [
  'ecs-fargate',
  'instrument',
  '--task-definition',
  'my-app',
  '-r',
  MOCK_REGION,
])

describe('ecs-fargate instrument', () => {
  beforeEach(() => {
    ecsMock.reset()
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition(), tags: []})
    ecsMock.on(RegisterTaskDefinitionCommand).resolves({taskDefinition: fargateTaskDefinition({revision: 2})})
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
  })

  test('tags the new revision with the CLI version', async () => {
    await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    const registered = ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input
    expect(registered.tags).toStrictEqual([CLI_VERSION_TAG])
  })

  test('registers nothing when only the CLI version tag is out of date', async () => {
    const {taskDefinition: instrumented} = instrumentTaskDefinition(fargateTaskDefinition(), MOCK_SETTINGS)
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: fargateTaskDefinition({containerDefinitions: instrumented.containerDefinitions}),
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
      taskDefinition: fargateTaskDefinition({containerDefinitions: instrumented.containerDefinitions}),
      tags: [],
    })

    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(code).toBe(0)
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
    expect(context.stdout.toString()).toContain('my-app is already instrumented')
  })

  test('warns when the API key is written in plain text', async () => {
    const {code, context} = await runCLI([], {DATADOG_API_KEY: '', DD_API_KEY: MOCK_API_KEY})

    expect(code).toBe(0)
    expect(context.stdout.toString()).toContain('in plain text')
    const registered = ecsMock.commandCalls(RegisterTaskDefinitionCommand)[0].args[0].input
    const agent = registered.containerDefinitions?.find((container) => container.name === AGENT_CONTAINER_NAME)
    expect(agent?.environment).toContainEqual({name: 'DD_API_KEY', value: MOCK_API_KEY})
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

  test('fails when no API key is available', async () => {
    const {code, context} = await runCLI([], {DD_API_KEY: '', DATADOG_API_KEY: ''})

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('No Datadog API key found')
    expect(ecsMock.commandCalls(DescribeTaskDefinitionCommand)).toHaveLength(0)
  })

  test('reports a task definition that cannot be instrumented', async () => {
    ecsMock
      .on(DescribeTaskDefinitionCommand)
      .resolves({taskDefinition: fargateTaskDefinition({networkMode: 'bridge'}), tags: []})

    const {code, context} = await runCLI(['--api-key-secret-arn', MOCK_API_KEY_SECRET_ARN])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Fargate requires awsvpc')
    expect(ecsMock.commandCalls(RegisterTaskDefinitionCommand)).toHaveLength(0)
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
