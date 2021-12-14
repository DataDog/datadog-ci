import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {Cli, Command} from 'clipanion/lib/advanced'
import {InstrumentCommand} from '../instrument'
import {UninstrumentCommand} from '../uninstrument'

export const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

export const makeCli = () => {
  const cli = new Cli()
  cli.register(InstrumentCommand)
  cli.register(UninstrumentCommand)

  return cli
}

/**
 * Allow for constructors with any amount of parameters.
 * Mainly used for testing when we are creating commands.
 */
export type ConstructorOf<T> = new (...args: any[]) => T

/**
 * Allows to create an instance of any command that
 * extends the Command clss.
 *
 * @param commandClass any class that extends the Command class.
 * @param parameters parameters to use while creating the commandClass
 * @returns the instance of the given command with a mock context attatched.
 */
export const createCommand = <T extends Command>(commandClass: ConstructorOf<T>, ...parameters: any[]) => {
  // Create a new instance of commandClass and pass in the parameters
  const command = new commandClass(...parameters)
  command.context = createMockContext() as any

  return command
}

export const makeMockLambda = (
  functionConfigs: Record<string, Lambda.FunctionConfiguration>,
  layers?: Record<string, Lambda.LayerVersionsListItem>
) => ({
  getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
    promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
  })),
  getLayerVersion: jest.fn().mockImplementation(({LayerName, VersionNumber}) => ({
    promise: () => {
      const layer = LayerName + ':' + VersionNumber

      return layers && layers[layer] && layers[layer].Version === VersionNumber
        ? Promise.resolve(layers[layer])
        : Promise.reject()
    },
  })),
  listFunctions: jest.fn().mockImplementation(() => ({
    promise: () => Promise.resolve({Functions: Object.values(functionConfigs)}),
  })),
  listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

export const makeMockCloudWatchLogs = (
  logGroups: Record<
    string,
    {config: CloudWatchLogs.DescribeLogGroupsResponse; filters?: CloudWatchLogs.DescribeSubscriptionFiltersResponse}
  >
) => ({
  createLogGroup: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  deleteSubscriptionFilter: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  describeLogGroups: jest.fn().mockImplementation(({logGroupNamePrefix}) => {
    const groups = logGroups[logGroupNamePrefix]?.config ?? {logGroups: []}

    return {
      promise: () => Promise.resolve(groups),
    }
  }),
  describeSubscriptionFilters: jest.fn().mockImplementation(({logGroupName}) => {
    const groups = logGroups[logGroupName]?.filters ?? {subscriptionFilters: []}

    return {
      promise: () => Promise.resolve(groups),
    }
  }),
  putSubscriptionFilter: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

export const mockAwsAccount = '123456789012'
export const mockAwsAccessKeyId = 'M0CKAWS4CC3SSK3Y1DSL'
export const mockAwsSecretAccessKey = 'M0CKAWSs3cR3T4cC3SSK3YS3rv3rL3SSD4tad0g!'
export const mockDatadogApiKey = '02aeb762fff59ac0d5ad1536cd9633bd'
