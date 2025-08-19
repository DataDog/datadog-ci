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
  LogStream,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  OutputLogEvent,
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
  ServiceInputTypes,
  ServiceOutputTypes,
  ListTagsCommandOutput,
} from '@aws-sdk/client-lambda'
import {MOCK_DATADOG_API_KEY} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {AwsStub} from 'aws-sdk-client-mock'

export const mockLambdaClientCommands = (lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes, any>) => {
  lambdaClientMock.on(UpdateFunctionConfigurationCommand).resolves({})
  lambdaClientMock.on(TagResourceCommand).resolves({})
  lambdaClientMock.on(GetLayerVersionCommand).rejects()
  lambdaClientMock.on(ListFunctionsCommand).resolves({Functions: []})
}

export const mockLambdaConfigurations = (
  lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes, any>,
  functionConfigurations: Record<string, {config: LFunctionConfiguration; tags?: ListTagsResponse}>
) => {
  const functions: LFunctionConfiguration[] = []
  for (const functionArn in functionConfigurations) {
    if (Object.prototype.hasOwnProperty.call(functionConfigurations, functionArn)) {
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
  }

  lambdaClientMock.on(ListFunctionsCommand).resolves({
    Functions: functions,
  })
}

export const mockLambdaLayers = (
  lambdaClientMock: AwsStub<LServiceInputTypes, LServiceOutputTypes, any>,
  layers: Record<string, GetLayerVersionCommandInput>
) => {
  for (const layerName in layers) {
    if (Object.prototype.hasOwnProperty.call(layers, layerName)) {
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
}

export const mockLogGroups = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes, any>,
  logGroups: Record<
    string,
    {
      config: DescribeLogGroupsResponse
      filters?: DescribeSubscriptionFiltersResponse
    }
  >
) => {
  for (const logGroupName in logGroups) {
    if (Object.prototype.hasOwnProperty.call(logGroups, logGroupName)) {
      const logGroup = logGroups[logGroupName]

      cloudWatchLogsClientMock
        .on(DescribeLogGroupsCommand, {logGroupNamePrefix: logGroupName})
        .resolves(logGroup.config)
      if (logGroup.filters !== undefined) {
        cloudWatchLogsClientMock
          .on(DescribeSubscriptionFiltersCommand, {
            logGroupName,
          })
          .resolves(logGroup.filters)
      }
    }
  }
}

export const mockCloudWatchLogsClientCommands = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes, any>
) => {
  cloudWatchLogsClientMock.on(DescribeLogGroupsCommand).resolves({})
  cloudWatchLogsClientMock.on(DescribeSubscriptionFiltersCommand).resolves({})
  cloudWatchLogsClientMock.on(CreateLogGroupCommand).resolves({})
  cloudWatchLogsClientMock.on(DeleteSubscriptionFilterCommand).resolves({})
  cloudWatchLogsClientMock.on(PutSubscriptionFilterCommand).resolves({})
}

export const mockCloudWatchLogStreams = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes, any>,
  logStreams: LogStream[]
) => {
  cloudWatchLogsClientMock.on(DescribeLogStreamsCommand).resolves({logStreams})
}

export const mockCloudWatchLogEvents = (
  cloudWatchLogsClientMock: AwsStub<CWLServiceInputTypes, CWLServiceOutputTypes, any>,
  events: OutputLogEvent[]
) => {
  cloudWatchLogsClientMock.on(GetLogEventsCommand).resolves({events})
}

export const mockResourceTags = (
  lambdaClientMock: AwsStub<ServiceInputTypes, ServiceOutputTypes, any>,
  output: ListTagsCommandOutput
) => {
  lambdaClientMock.on(ListTagsCommand).resolves(output)
}

export const mockAwsAccount = '123456789012'
export const mockAwsAccessKeyId = 'M0CKAWS4CC3SSK3Y1DSL'
export const mockAwsSecretAccessKey = 'M0CKAWSs3cR3T4cC3SSK3YS3rv3rL3SSD4tad0g0'
export const mockAwsCredentials = {
  accessKeyId: mockAwsAccessKeyId,
  secretAccessKey: mockAwsSecretAccessKey,
  sessionToken: undefined,
}

export const mockDatadogEnv = 'sandbox'
export const mockDatadogService = 'testServiceName'
export const mockDatadogVersion = '1.0.0'

export const MOCK_LAMBDA_CONFIG = {
  Environment: {
    Variables: {
      DD_API_KEY: MOCK_DATADOG_API_KEY,
      DD_SITE: 'datadoghq.com',
      DD_LOG_LEVEL: 'debug',
    },
  },
  FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:some-function',
  FunctionName: 'some-function',
  Runtime: 'nodejs18.x',
  CodeSize: 2275,
  Layers: [
    {
      Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:43',
      CodeSize: 13145076,
    },
    {
      Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node18-x:91',
      CodeSize: 3614995,
    },
  ],
  Handler: '/path/handler.handler',
  Timeout: 6,
  MemorySize: 1024,
  Architectures: ['x86_64'],
}
