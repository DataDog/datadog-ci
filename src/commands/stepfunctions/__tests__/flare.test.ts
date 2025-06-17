import fs from 'fs'

import upath from 'upath'

import {
  CloudWatchLogsClient,
  DescribeSubscriptionFiltersCommand,
  GetLogEventsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  SFNClient,
  DescribeStateMachineCommand,
  ListTagsForResourceCommand,
  ListExecutionsCommand,
  GetExecutionHistoryCommand,
  DescribeExecutionCommand,
  ExecutionStatus,
} from '@aws-sdk/client-sfn'
import {mockClient} from 'aws-sdk-client-mock'
import 'aws-sdk-client-mock-jest'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../../constants'
import {createDirectories, writeFile, zipContents} from '../../../helpers/fs'
import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {StepFunctionsFlareCommand} from '../flare'

import {
  stateMachineConfigFixture,
  sensitiveStateMachineConfigFixture,
  executionsFixture,
  sensitiveExecutionFixture,
  executionHistoryFixture,
  stepFunctionTagsFixture,
  logSubscriptionFiltersFixture,
  cloudWatchLogsFixture,
  MOCK_STATE_MACHINE_ARN,
  MOCK_REGION,
  MOCK_CASE_ID,
  MOCK_EMAIL,
  MOCK_API_KEY,
  MOCK_OUTPUT_DIR,
} from './fixtures/stepfunctions-flare'

// Mock the AWS SDK clients
const sfnClientMock = mockClient(SFNClient)
const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)

// Mock the helpers
jest.mock('../../../helpers/fs')
jest.mock('../../../helpers/flare')
jest.mock('../../../helpers/prompt')
jest.mock('fs')

describe('StepFunctionsFlareCommand', () => {
  let command: StepFunctionsFlareCommand
  const runCLI = makeRunCLI(StepFunctionsFlareCommand, ['stepfunctions', 'flare'])

  // Helper function to set up command with values for unit testing
  // This simulates what Clipanion does when parsing command line arguments
  const setupCommand = (options: {
    stateMachineArn?: string
    caseId?: string  
    email?: string
    region?: string
  }) => {
    const cmd = new StepFunctionsFlareCommand()
    // Override the Option objects with actual values for testing
    ;(cmd as any).stateMachineArn = options.stateMachineArn
    ;(cmd as any).caseId = options.caseId
    ;(cmd as any).email = options.email
    ;(cmd as any).region = options.region
    return cmd
  }

  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks()
    sfnClientMock.reset()
    cloudWatchLogsClientMock.reset()

    // Set up environment
    process.env[CI_API_KEY_ENV_VAR] = MOCK_API_KEY

    // Create command instance for unit tests
    command = new StepFunctionsFlareCommand()
  })

  afterEach(() => {
    delete process.env[CI_API_KEY_ENV_VAR]
  })

  describe('validateInputs', () => {

    it('should return 1 when state machine ARN is missing', async () => {
      const cmd = setupCommand({})
      const result = await cmd['validateInputs']()
      expect(result).toBe(1)
    })

    it('should return 1 when case ID is missing', async () => {
      const cmd = setupCommand({stateMachineArn: MOCK_STATE_MACHINE_ARN})
      const result = await cmd['validateInputs']()
      expect(result).toBe(1)
    })

    it('should return 1 when email is missing', async () => {
      const cmd = setupCommand({
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        caseId: MOCK_CASE_ID,
      })
      const result = await cmd['validateInputs']()
      expect(result).toBe(1)
    })

    it('should return 1 when API key is missing', async () => {
      delete process.env[CI_API_KEY_ENV_VAR]
      delete process.env[API_KEY_ENV_VAR]
      const cmd = setupCommand({
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        caseId: MOCK_CASE_ID,
        email: MOCK_EMAIL,
      })
      const result = await cmd['validateInputs']()
      expect(result).toBe(1)
    })

    it('should return 1 when state machine ARN is invalid', async () => {
      const cmd = setupCommand({
        stateMachineArn: 'invalid-arn',
        caseId: MOCK_CASE_ID,
        email: MOCK_EMAIL,
      })
      const result = await cmd['validateInputs']()
      expect(result).toBe(1)
    })

    it('should return 0 when all required inputs are valid', async () => {
      const cmd = setupCommand({
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        caseId: MOCK_CASE_ID,
        email: MOCK_EMAIL,
        region: MOCK_REGION,
      })
      const result = await cmd['validateInputs']()
      expect(result).toBe(0)
    })
  })

  describe('getStateMachineConfiguration', () => {
    it('should fetch state machine configuration', async () => {
      const mockConfig = stateMachineConfigFixture()
      sfnClientMock.on(DescribeStateMachineCommand).resolves(mockConfig)

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const result = await command['getStateMachineConfiguration'](sfnClient, MOCK_STATE_MACHINE_ARN)

      expect(result).toEqual(mockConfig)
      expect(sfnClientMock).toHaveReceivedCommandWith(DescribeStateMachineCommand, {
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        includedData: 'ALL_DATA',
      })
    })

    it('should handle errors when fetching configuration', async () => {
      sfnClientMock.on(DescribeStateMachineCommand).rejects(new Error('State machine not found'))

      const sfnClient = new SFNClient({region: MOCK_REGION})

      await expect(command['getStateMachineConfiguration'](sfnClient, MOCK_STATE_MACHINE_ARN)).rejects.toThrow(
        'State machine not found'
      )
    })
  })

  describe('getStateMachineTags', () => {
    it('should fetch and format state machine tags', async () => {
      const mockTags = stepFunctionTagsFixture()
      sfnClientMock.on(ListTagsForResourceCommand).resolves({tags: mockTags})

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const result = await command['getStateMachineTags'](sfnClient, MOCK_STATE_MACHINE_ARN)

      expect(result).toEqual({
        Environment: 'test',
        Service: 'payment-processor',
        Team: 'platform',
      })
      expect(sfnClientMock).toHaveReceivedCommandWith(ListTagsForResourceCommand, {
        resourceArn: MOCK_STATE_MACHINE_ARN,
      })
    })

    it('should return empty object when no tags exist', async () => {
      sfnClientMock.on(ListTagsForResourceCommand).resolves({tags: []})

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const result = await command['getStateMachineTags'](sfnClient, MOCK_STATE_MACHINE_ARN)

      expect(result).toEqual({})
    })
  })

  describe('getRecentExecutions', () => {
    it('should fetch recent executions with default limit', async () => {
      const mockExecutions = executionsFixture()
      sfnClientMock.on(ListExecutionsCommand).resolves({executions: mockExecutions})

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const result = await command['getRecentExecutions'](sfnClient, MOCK_STATE_MACHINE_ARN)

      expect(result).toEqual(mockExecutions)
      expect(sfnClientMock).toHaveReceivedCommandWith(ListExecutionsCommand, {
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        maxResults: 10,
      })
    })

    it('should respect custom maxExecutions parameter', async () => {
      command['maxExecutions'] = '5'
      const mockExecutions = executionsFixture()
      sfnClientMock.on(ListExecutionsCommand).resolves({executions: mockExecutions})

      const sfnClient = new SFNClient({region: MOCK_REGION})
      await command['getRecentExecutions'](sfnClient, MOCK_STATE_MACHINE_ARN)

      expect(sfnClientMock).toHaveReceivedCommandWith(ListExecutionsCommand, {
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
        maxResults: 5,
      })
    })
  })

  describe('getExecutionHistory', () => {
    it('should fetch execution history events', async () => {
      const mockHistory = executionHistoryFixture()
      sfnClientMock.on(GetExecutionHistoryCommand).resolves({events: mockHistory})

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const executionArn = 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1'
      const result = await command['getExecutionHistory'](sfnClient, executionArn)

      expect(result).toEqual(mockHistory)
      expect(sfnClientMock).toHaveReceivedCommandWith(GetExecutionHistoryCommand, {
        executionArn,
        includeExecutionData: true,
        maxResults: 500,
      })
    })
  })

  describe('getLogSubscriptions', () => {
    it('should fetch log subscription filters', async () => {
      const mockFilters = logSubscriptionFiltersFixture()
      cloudWatchLogsClientMock.on(DescribeSubscriptionFiltersCommand).resolves({
        subscriptionFilters: mockFilters,
      })

      const cwClient = new CloudWatchLogsClient({region: MOCK_REGION})
      const logGroupName = '/aws/vendedlogs/states/MyWorkflow-Logs'
      const result = await command['getLogSubscriptions'](cwClient, logGroupName)

      expect(result).toEqual(mockFilters)
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandWith(DescribeSubscriptionFiltersCommand, {
        logGroupName,
      })
    })

    it('should return empty array when log group does not exist', async () => {
      cloudWatchLogsClientMock.on(DescribeSubscriptionFiltersCommand).rejects(new Error('ResourceNotFoundException'))

      const cwClient = new CloudWatchLogsClient({region: MOCK_REGION})
      const logGroupName = '/aws/vendedlogs/states/MyWorkflow-Logs'
      const result = await command['getLogSubscriptions'](cwClient, logGroupName)

      expect(result).toEqual([])
    })
  })

  describe('getCloudWatchLogs', () => {
    it('should fetch and organize CloudWatch logs', async () => {
      const mockLogs = cloudWatchLogsFixture()
      cloudWatchLogsClientMock
        .on(DescribeLogStreamsCommand)
        .resolves({
          logStreams: [{logStreamName: 'stream1'}, {logStreamName: 'stream2'}],
        })
        .on(GetLogEventsCommand)
        .resolves({events: mockLogs})

      const cwClient = new CloudWatchLogsClient({region: MOCK_REGION})
      const logGroupName = '/aws/vendedlogs/states/MyWorkflow-Logs'
      const result = await command['getCloudWatchLogs'](cwClient, logGroupName)

      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBeGreaterThan(0)
    })
  })

  describe('maskStateMachineConfig', () => {
    it('should mask sensitive data in state machine configuration', () => {
      const sensitiveConfig = sensitiveStateMachineConfigFixture()
      const maskedConfig = command['maskStateMachineConfig'](sensitiveConfig)

      // Verify that sensitive data is masked
      const maskedDefinition = JSON.parse(maskedConfig.definition!)
      expect(maskedDefinition.States.ProcessPayment.Parameters.SecretToken).not.toBe('secret-12345-token')
      expect(maskedDefinition.States.ProcessPayment.Parameters.DatabasePassword).not.toBe('super-secret-password')
    })
  })

  describe('maskExecutionData', () => {
    it('should mask sensitive execution input/output', () => {
      const sensitiveExecution = sensitiveExecutionFixture()
      const maskedExecution = command['maskExecutionData'](sensitiveExecution)

      // Verify that input and output are masked
      expect(maskedExecution.input).not.toContain('4111-1111-1111-1111')
      expect(maskedExecution.output).not.toContain('Bearer secret-token')
    })
  })

  describe('generateInsightsFile', () => {
    it('should generate insights file with correct content', () => {
      // Mock fs.readdirSync for getFramework call
      ;(fs.readdirSync as jest.Mock).mockReturnValue([])
      
      const mockConfig = stateMachineConfigFixture()
      const filePath = upath.join(MOCK_OUTPUT_DIR, 'INSIGHTS.md')

      command['generateInsightsFile'](filePath, false, mockConfig, undefined)

      expect(writeFile).toHaveBeenCalledWith(filePath, expect.stringContaining('Step Functions Flare Insights'))
      expect(writeFile).toHaveBeenCalledWith(filePath, expect.stringContaining('MyWorkflow'))
    })
  })


  describe('getFramework', () => {
    it('should detect Serverless Framework', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValue(['serverless.yml', 'package.json'])

      const framework = command['getFramework']()

      expect(framework).toContain('Serverless Framework')
    })

    it('should detect AWS SAM', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValue(['template.yaml', 'samconfig.toml'])

      const framework = command['getFramework']()

      expect(framework).toContain('AWS SAM')
    })

    it('should detect AWS CDK', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValue(['cdk.json', 'tsconfig.json'])

      const framework = command['getFramework']()

      expect(framework).toContain('AWS CDK')
    })

    it('should return Unknown when no framework detected', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValue(['index.js', 'README.md'])

      const framework = command['getFramework']()

      expect(framework).toBe('Unknown')
    })
  })

  describe('createOutputDirectory', () => {
    it('should create output directory structure', async () => {
      ;(createDirectories as jest.Mock).mockResolvedValue(undefined)
      
      // Set up command with stateMachineArn
      const cmd = setupCommand({
        stateMachineArn: MOCK_STATE_MACHINE_ARN,
      })

      const outputDir = await cmd['createOutputDirectory']()

      expect(outputDir).toContain('.datadog-ci')
      expect(outputDir).toContain('MyWorkflow')
      expect(createDirectories).toHaveBeenCalled()
    })
  })

  describe('writeOutputFiles', () => {
    it('should write all output files', async () => {
      const mockData = {
        config: stateMachineConfigFixture(),
        tags: {Environment: 'test'},
        executions: executionsFixture(),
        subscriptionFilters: logSubscriptionFiltersFixture(),
        logs: new Map([['stream1', cloudWatchLogsFixture()]]),
      }

      await command['writeOutputFiles'](MOCK_OUTPUT_DIR, mockData)

      expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('state_machine_config.json'), expect.any(String))
      expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('tags.json'), expect.any(String))
      expect(writeFile).toHaveBeenCalledWith(expect.stringContaining('recent_executions.json'), expect.any(String))
    })
  })


  describe('parseStateMachineArn', () => {
    it('should correctly parse state machine ARN', () => {
      const parsed = command['parseStateMachineArn'](MOCK_STATE_MACHINE_ARN)

      expect(parsed).toEqual({
        region: 'us-east-1',
        name: 'MyWorkflow',
      })
    })
  })

  describe('getLogGroupName', () => {
    it('should extract log group name from configuration', () => {
      const mockConfig = stateMachineConfigFixture()
      const logGroupName = command['getLogGroupName'](mockConfig)

      expect(logGroupName).toBe('/aws/vendedlogs/states/MyWorkflow-Logs')
    })

    it('should return undefined when no logging configuration', () => {
      const mockConfig = stateMachineConfigFixture()
      mockConfig.loggingConfiguration = undefined

      const logGroupName = command['getLogGroupName'](mockConfig)

      expect(logGroupName).toBeUndefined()
    })
  })

  describe('maskAslDefinition', () => {
    it('should mask sensitive fields in ASL definition', () => {
      const sensitiveAsl = JSON.stringify({
        States: {
          ProcessPayment: {
            Parameters: {
              ApiKey: 'secret-api-key',
              Password: 'secret-password',
            },
          },
        },
      })

      const maskedAsl = command['maskAslDefinition'](sensitiveAsl)
      const parsed = JSON.parse(maskedAsl)

      expect(parsed.States.ProcessPayment.Parameters.ApiKey).not.toBe('secret-api-key')
      expect(parsed.States.ProcessPayment.Parameters.Password).not.toBe('secret-password')
    })
  })

  describe('getExecutionDetails', () => {
    it('should fetch detailed execution information', async () => {
      const mockExecutionDetails = {
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1',
        status: ExecutionStatus.SUCCEEDED,
        input: '{"orderId": "12345"}',
        output: '{"result": "success"}',
      }

      sfnClientMock.on(DescribeExecutionCommand).resolves(mockExecutionDetails)

      const sfnClient = new SFNClient({region: MOCK_REGION})
      const result = await command['getExecutionDetails'](
        sfnClient,
        'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1'
      )

      expect(result).toEqual(mockExecutionDetails)
    })
  })

  describe('execute', () => {
    let context: any

    beforeEach(() => {
      // Create command with context
      context = {
        stdout: {write: jest.fn()},
        stderr: {write: jest.fn()},
      }
      command.context = context

      // Set command options
      ;(command as any).stateMachineArn = MOCK_STATE_MACHINE_ARN
      ;(command as any).caseId = MOCK_CASE_ID
      ;(command as any).email = MOCK_EMAIL
      ;(command as any).region = MOCK_REGION
      ;(command as any).isDryRun = true
      ;(command as any).withLogs = false
    })

    it('should successfully execute in dry run mode', async () => {
      // Mock AWS responses
      sfnClientMock.on(DescribeStateMachineCommand).resolves(stateMachineConfigFixture())
      sfnClientMock.on(ListTagsForResourceCommand).resolves({tags: stepFunctionTagsFixture()})
      sfnClientMock.on(ListExecutionsCommand).resolves({executions: executionsFixture()})
      sfnClientMock.on(DescribeExecutionCommand).resolves({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1',
        status: 'SUCCEEDED',
        input: '{"orderId": "12345"}',
        output: '{"result": "success"}',
      })
      sfnClientMock.on(GetExecutionHistoryCommand).resolves({events: executionHistoryFixture()})
      
      // Mock fs.readdirSync for getFramework
      ;(fs.readdirSync as jest.Mock).mockReturnValue(['serverless.yml'])

      const result = await command.execute()

      expect(result).toBe(0)
      expect(context.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Collecting Step Functions flare data'))
      expect(context.stdout.write).toHaveBeenCalledWith(expect.stringContaining('The flare files were not sent because the command was executed in dry run mode'))
      expect(context.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Your output files are located at'))
      expect(context.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Flare data collection complete!'))
    })

    it('should handle missing required parameters', async () => {
      ;(command as any).stateMachineArn = undefined

      const result = await command.execute()

      expect(result).toBe(1)
      expect(context.stdout.write).toHaveBeenCalledWith(
        'Usage: datadog-ci stepfunctions flare -s <state-machine-arn> -c <case-id> -e <email>\n'
      )
    })

    it('should handle AWS API errors gracefully', async () => {
      sfnClientMock.on(DescribeStateMachineCommand).rejects(new Error('State machine not found'))

      const result = await command.execute()

      expect(result).toBe(1)
      expect(context.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Error collecting flare data'))
    })
  })
})
