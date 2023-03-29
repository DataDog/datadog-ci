import {
  DescribeSubscriptionFiltersCommand,
  DescribeLogGroupsResponse,
  DescribeSubscriptionFiltersResponse,
  ServiceInputTypes as CWLServiceInputTypes,
  ServiceOutputTypes as CWLServiceOutputTypes,
  DescribeLogGroupsCommand,
  CreateLogGroupCommand,
  DeleteSubscriptionFilterCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  FunctionConfiguration as LFunctionConfiguration,
  ServiceInputTypes as LServiceInputTypes,
  ServiceOutputTypes as LServiceOutputTypes,
  GetLayerVersionCommand,
  GetFunctionCommand,
  ListFunctionsCommand,
  UpdateFunctionConfigurationCommand,
  TagResourceCommand,
  ListTagsCommand,
  ListTagsResponse,
  GetLayerVersionCommandInput,
} from '@aws-sdk/client-lambda'
import {AwsStub} from 'aws-sdk-client-mock'
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

export const mockLambdaClientCommands = (lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes>) => {
  lambdaClientMock.on(UpdateFunctionConfigurationCommand).resolves({})
  lambdaClientMock.on(TagResourceCommand).resolves({})
  lambdaClientMock.on(GetLayerVersionCommand).rejects()
  lambdaClientMock.on(ListFunctionsCommand).resolves({Functions: []})
}

export const mockLambdaConfigurations = (
  lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes>,
  functionConfigurations: Record<string, {config: LFunctionConfiguration; tags?: ListTagsResponse}>
) => {
  const functions: LFunctionConfiguration[] = []
  for (const functionArn in functionConfigurations) {
    const functionConfiguration = functionConfigurations[functionArn]
    functions.push(functionConfiguration.config)

    lambdaClientMock
      .on(GetFunctionCommand, {
        FunctionName: functionArn,
      })
      .resolves({
        Configuration: functionConfiguration.config,
      })

    lambdaClientMock
      .on(ListTagsCommand, {
        Resource: functionArn,
      })
      .resolves({
        Tags: functionConfiguration.tags?.Tags ?? {},
      })
  }

  lambdaClientMock.on(ListFunctionsCommand).resolves({
    Functions: functions,
  })
}

export const mockLambdaLayers = (
  lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes>,
  layers: Record<string, GetLayerVersionCommandInput>
) => {
  for (const layerName in layers) {
    const layer = layers[layerName]

    lambdaClientMock
      .on(GetLayerVersionCommand, {
        LayerName: layer.LayerName,
        VersionNumber: layer.VersionNumber,
      })
      .resolves({
        LayerArn: layerName,
      })
  }
}

export const mockLogGroups = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes>,
  logGroups: Record<
    string,
    {
      config: DescribeLogGroupsResponse
      filters?: DescribeSubscriptionFiltersResponse
    }
  >
) => {
  for (const logGroupName in logGroups) {
    const logGroup = logGroups[logGroupName]

    cloudWatchLogsClientMock.on(DescribeLogGroupsCommand, {logGroupNamePrefix: logGroupName}).resolves(logGroup.config)
    if (logGroup.filters !== undefined) {
      cloudWatchLogsClientMock
        .on(DescribeSubscriptionFiltersCommand, {
          logGroupName,
        })
        .resolves(logGroup.filters)
    }
  }
}

export const mockCloudWatchLogsClientCommands = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes>
) => {
  cloudWatchLogsClientMock.on(DescribeLogGroupsCommand).resolves({})
  cloudWatchLogsClientMock.on(DescribeSubscriptionFiltersCommand).resolves({})
  cloudWatchLogsClientMock.on(CreateLogGroupCommand).resolves({})
  cloudWatchLogsClientMock.on(DeleteSubscriptionFilterCommand).resolves({})
  cloudWatchLogsClientMock.on(PutSubscriptionFilterCommand).resolves({})
}

export const mockAwsAccount = '123456789012'
export const mockAwsAccessKeyId = 'M0CKAWS4CC3SSK3Y1DSL'
export const mockAwsSecretAccessKey = 'M0CKAWSs3cR3T4cC3SSK3YS3rv3rL3SSD4tad0g0'
export const mockAwsCredentials = {
  accessKeyId: mockAwsAccessKeyId,
  secretAccessKey: mockAwsSecretAccessKey,
  sessionToken: undefined,
}

export const mockDatadogApiKey = '02aeb762fff59ac0d5ad1536cd9633bd'
export const mockDatadogEnv = 'sandbox'
export const mockDatadogService = 'testServiceName'
export const mockDatadogVersion = '1.0.0'
