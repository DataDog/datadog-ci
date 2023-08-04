import fs from 'fs'
import process from 'process'
import stream from 'stream'

import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  LogStream,
  OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs'
import {LambdaClient, ListTagsCommand} from '@aws-sdk/client-lambda'
import {mockClient} from 'aws-sdk-client-mock'
import JSZip from 'jszip'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../../constants'
import {
  createMockContext,
  MOCK_CWD,
  MOCK_DATADOG_API_KEY,
  MOCK_FLARE_FOLDER_PATH,
} from '../../../helpers/__tests__/fixtures'
import * as fsModule from '../../../helpers/fs'
import * as helpersPromptModule from '../../../helpers/prompt'

import {AWS_DEFAULT_REGION_ENV_VAR, DeploymentFrameworks, PROJECT_FILES} from '../constants'
import {
  convertToCSV,
  generateInsightsFile,
  getAllLogs,
  getFramework,
  getLogEvents,
  getLogStreamNames,
  getProjectFiles,
  getTags,
  getUniqueFileNames,
  validateFilePath,
  validateStartEndFlags,
} from '../flare'
import * as flareModule from '../flare'
import {getAWSCredentials, getLambdaFunctionConfig, maskConfig} from '../functions/commons'
import * as lambdaPromptModule from '../prompt'
import {requestAWSCredentials} from '../prompt'

import {
  makeCli,
  MOCK_LAMBDA_CONFIG,
  mockAwsCredentials,
  mockCloudWatchLogEvents,
  mockCloudWatchLogsClientCommands,
  mockCloudWatchLogStreams,
  mockResourceTags,
} from './fixtures'

// Constants
const MOCK_REGION = 'us-east-1'
const MOCK_REQUIRED_FLAGS = ['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com']
const MOCK_LOG_GROUP = 'mockLogGroup'
const MOCK_TAGS: any = {Tags: {}}
const MOCK_READ_STREAM = new stream.Readable({
  read() {
    this.push(JSON.stringify(MOCK_LAMBDA_CONFIG, undefined, 2))
    this.push(undefined)
  },
})
const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)
const lambdaClientMock = mockClient(LambdaClient)

// Commons mocks
jest.mock('../functions/commons', () => ({
  ...jest.requireActual('../functions/commons'),
  getAWSCredentials: jest.fn(),
  getLambdaFunctionConfig: jest.fn().mockImplementation(() => Promise.resolve(MOCK_LAMBDA_CONFIG)),
}))

// Prompt mocks
jest.mock('../prompt')
jest.spyOn(lambdaPromptModule, 'requestFilePath').mockResolvedValue('')
jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValue(true)
jest.spyOn(flareModule, 'getProjectFiles').mockResolvedValue(new Set())

// File system mocks
process.cwd = jest.fn().mockReturnValue(MOCK_CWD)
jest.mock('fs')
fs.writeFileSync = jest.fn().mockImplementation(() => {})
fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(MOCK_LAMBDA_CONFIG, undefined, 2))
fs.existsSync = jest.fn().mockReturnValue(true)
fs.createReadStream = jest.fn().mockReturnValue(MOCK_READ_STREAM)
fs.readdirSync = jest.fn().mockReturnValue([])
;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
  isDirectory: () => file_path === MOCK_FLARE_FOLDER_PATH || file_path === MOCK_CWD,
}))

// Zip mocks
jest.mock('jszip')
const mockJSZip = {
  file: jest.fn(),
  generateAsync: jest.fn().mockResolvedValue('zip content'),
}
;(JSZip as any).mockImplementation(() => mockJSZip)

// Date
jest.useFakeTimers({advanceTimers: true, now: new Date(Date.UTC(2023, 0))})
jest.spyOn(flareModule, 'sleep').mockResolvedValue()

// Misc
jest.mock('util')
jest.mock('../../../../package.json', () => ({
  version: '1.0-mock-version',
}))

describe('lambda flare', () => {
  beforeAll(() => {
    mockResourceTags(lambdaClientMock, MOCK_TAGS)
  })

  describe('prints correct headers', () => {
    it('prints non-dry-run header', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare'], context as any)
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchSnapshot()
    })

    it('prints dry-run header', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-d'], context as any)
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchSnapshot()
    })
  })

  describe('validates required flags', () => {
    beforeEach(() => {
      process.env = {[CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY}
    })

    it('prints error when no function specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['lambda', 'flare', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no region specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-c', '123', '-e', 'test@test.com'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('extracts region from function name when given a function ARN', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        [
          'lambda',
          'flare',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:my-function',
          '-c',
          '123',
          '-e',
          'test@test.com',
        ],
        context as any
      )
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('uses region ENV variable when no region specified', async () => {
      process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'test-region'
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-c', '123', '-e', 'test@test.com'], context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no API key in env variables', async () => {
      process.env = {}
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('uses API key ENV variable and runs as expected', async () => {
      process.env = {}
      process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      process.env[API_KEY_ENV_VAR] = undefined
      const cli = makeCli()
      const context = createMockContext()
      let code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(0)
      let output = context.stdout.toString()
      expect(output).toMatchSnapshot()

      process.env[CI_API_KEY_ENV_VAR] = undefined
      process.env[API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(0)
      output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no case ID specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no email specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', MOCK_REGION, '-c', '123'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('runs successfully with all required options specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when start time is specified but end time is not', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--start', '100'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when end time is specified but start time is not', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--end', '100'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when start time is invalid', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--start', '123abc', '--end', '200'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when end time is invalid', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--start', '100', '--end', '123abc'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when start time is after end time', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--start', '200', '--end', '100'], context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('runs successfully when start and end times are valid', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '--start', '100', '--end', '200'], context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('validateStartEndFlags', () => {
    it('returns [undefined, undefined] when start and end flags are not specified', () => {
      const errorMessages: string[] = []
      const res = validateStartEndFlags(undefined, undefined)
      expect(res).toEqual([undefined, undefined])
      expect(errorMessages).toEqual([])
    })

    it('throws error when start is specified but end is not specified', () => {
      expect(() => validateStartEndFlags('123', undefined)).toThrowErrorMatchingSnapshot()
    })

    it('throws error when end is specified but start is not specified', () => {
      expect(() => validateStartEndFlags(undefined, '123')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when start is invalid', () => {
      expect(() => validateStartEndFlags('123abc', '200')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when end is invalid', () => {
      expect(() => validateStartEndFlags('100', '234abc')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when start is not before the end time', () => {
      expect(() => validateStartEndFlags('200', '100')).toThrowErrorMatchingSnapshot()
    })

    it('sets end time to current time if end time is too large', () => {
      const now = Date.now()
      const res = validateStartEndFlags('0', '9999999999999')
      expect(res).not.toBeUndefined()
      const [start, end] = res
      expect(start).toBe(0)
      expect(end).toEqual(now)
    })
  })

  describe('validateFilePath', () => {
    const projectFilePaths = new Set<string>()
    const additionalFilePaths = new Set<string>()

    it('returns the correct path when the file exists', () => {
      const filePath = '/exists'

      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(true)
      const result = validateFilePath(filePath, projectFilePaths, additionalFilePaths)

      expect(result).toBe(filePath)
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })

    it('returns the correct path when the file exists relative to the cwd', () => {
      const filePath = 'relative'

      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true)

      const result = validateFilePath(filePath, projectFilePaths, additionalFilePaths)

      expect(result).toContain(filePath)
      expect(fs.existsSync).toHaveBeenNthCalledWith(1, filePath)
      expect(fs.existsSync).toHaveBeenCalledTimes(2)
    })

    it('throws an error when the file does not exist', async () => {
      const filePath = '/not-exists'

      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      expect(() => validateFilePath(filePath, projectFilePaths, additionalFilePaths)).toThrowErrorMatchingSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })

    it('throws an error when the file has already been added', async () => {
      const filePath = '/added'

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      projectFilePaths.add(filePath)

      expect(() => validateFilePath(filePath, projectFilePaths, additionalFilePaths)).toThrowErrorMatchingSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })
  })

  describe('getLogStreamNames', () => {
    beforeEach(() => {
      cloudWatchLogsClientMock.reset()
      mockCloudWatchLogsClientCommands(cloudWatchLogsClientMock)
    })

    it('returns the 3 latest log stream names sorted by last event time', async () => {
      const mockStreams: LogStream[] = [
        {logStreamName: 'Stream3'},
        {logStreamName: 'Stream2'},
        {logStreamName: 'Stream1'},
      ]
      mockCloudWatchLogStreams(cloudWatchLogsClientMock, mockStreams)

      const expectedLogStreams = ['Stream1', 'Stream2', 'Stream3']
      const logStreams = await getLogStreamNames(new CloudWatchLogsClient({}), MOCK_LOG_GROUP, undefined, undefined)

      expect(logStreams).toEqual(expectedLogStreams)
    })

    it('returns empty array when no log streams are found', async () => {
      mockCloudWatchLogStreams(cloudWatchLogsClientMock, [])

      const logStreams = await getLogStreamNames(new CloudWatchLogsClient({}), MOCK_LOG_GROUP, undefined, undefined)

      expect(logStreams).toEqual([])
    })

    it('throws error when log streams cannot be retrieved', async () => {
      cloudWatchLogsClientMock.on(DescribeLogStreamsCommand).rejects('Cannot retrieve log streams')

      await expect(
        getLogStreamNames(
          (cloudWatchLogsClientMock as unknown) as CloudWatchLogsClient,
          MOCK_LOG_GROUP,
          undefined,
          undefined
        )
      ).rejects.toThrow('Cannot retrieve log streams')
    })

    it('returns log streams within the specified time range', async () => {
      const mockStreams: LogStream[] = [
        {logStreamName: 'Stream1', firstEventTimestamp: 100, lastEventTimestamp: 200},
        {logStreamName: 'Stream2', firstEventTimestamp: 200, lastEventTimestamp: 300},
        {logStreamName: 'Stream3', firstEventTimestamp: 300, lastEventTimestamp: 400},
        {logStreamName: 'Stream4', firstEventTimestamp: 400, lastEventTimestamp: 500},
      ]
      mockCloudWatchLogStreams(cloudWatchLogsClientMock, mockStreams)

      const expectedLogStreams = ['Stream2', 'Stream1']
      const logStreams = await getLogStreamNames(new CloudWatchLogsClient({}), MOCK_LOG_GROUP, 0, 250)

      expect(logStreams).toEqual(expectedLogStreams)
    })
  })

  describe('getLogEvents', () => {
    beforeEach(() => {
      cloudWatchLogsClientMock.reset()
      mockCloudWatchLogsClientCommands(cloudWatchLogsClientMock)
    })

    const MOCK_LOG_STREAM = 'mockLogStream'
    it('returns the log events for a log stream', async () => {
      mockCloudWatchLogEvents(cloudWatchLogsClientMock, [
        {timestamp: 123, message: 'Log1'},
        {timestamp: 456, message: 'Log2'},
      ])

      const expectedEvents = [
        {timestamp: 123, message: 'Log1'},
        {timestamp: 456, message: 'Log2'},
      ]

      const logEvents = await getLogEvents(
        (cloudWatchLogsClientMock as unknown) as CloudWatchLogsClient,
        MOCK_LOG_GROUP,
        MOCK_LOG_STREAM,
        undefined,
        undefined
      )

      expect(logEvents).toEqual(expectedEvents)
    })

    it('returns empty array when no log events are found', async () => {
      mockCloudWatchLogEvents(cloudWatchLogsClientMock, [])

      const logEvents = await getLogEvents(
        (cloudWatchLogsClientMock as unknown) as CloudWatchLogsClient,
        MOCK_LOG_GROUP,
        MOCK_LOG_STREAM,
        undefined,
        undefined
      )

      expect(logEvents).toEqual([])
    })

    it('throws error when log events cannot be retrieved', async () => {
      cloudWatchLogsClientMock.on(GetLogEventsCommand).rejects('Cannot retrieve log events')
      await expect(
        getLogEvents(
          (cloudWatchLogsClientMock as unknown) as CloudWatchLogsClient,
          MOCK_LOG_GROUP,
          MOCK_LOG_STREAM,
          undefined,
          undefined
        )
      ).rejects.toThrow('Cannot retrieve log events')
    })

    it('sets start and end time when provided', async () => {
      const mockStartTime = 100
      const mockEndTime = 200

      const logEvents = [
        {timestamp: 125, message: 'Log1'},
        {timestamp: 150, message: 'Log2'},
        {timestamp: 175, message: 'Log3'},
      ]

      const sendMock: any = jest.fn().mockResolvedValue({events: logEvents})
      cloudWatchLogsClientMock.send = sendMock

      const logEventsResult = await getLogEvents(
        (cloudWatchLogsClientMock as unknown) as CloudWatchLogsClient,
        MOCK_LOG_GROUP,
        MOCK_LOG_STREAM,
        mockStartTime,
        mockEndTime
      )

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            logGroupName: MOCK_LOG_GROUP,
            logStreamName: MOCK_LOG_STREAM,
            limit: 1000,
            startTime: mockStartTime,
            endTime: mockEndTime,
          }),
        })
      )

      expect(logEventsResult).toEqual(logEvents)
    })
  })

  describe('getAllLogs', () => {
    const functionName = 'testFunction'
    const mockStreamName = 'streamName'

    it('returns a map of log streams and their events', async () => {
      const mockLogs = [
        {timestamp: 123, message: 'log message 1'},
        {timestamp: 124, message: 'log message 2'},
      ] as OutputLogEvent[]

      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValue([mockStreamName])
      jest.spyOn(flareModule, 'getLogEvents').mockResolvedValue(mockLogs)

      const result = await getAllLogs(MOCK_REGION, functionName, undefined, undefined)
      expect(result.get(mockStreamName)).toEqual(mockLogs)
    })

    it('throws an error when unable to get log streams', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockRejectedValueOnce(new Error('Error getting log streams'))

      await expect(getAllLogs(MOCK_REGION, functionName, undefined, undefined)).rejects.toMatchSnapshot()
    })

    it('throws an error when unable to get log events', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValueOnce([mockStreamName])
      jest.spyOn(flareModule, 'getLogEvents').mockRejectedValueOnce(new Error('Error getting log events'))

      await expect(getAllLogs(MOCK_REGION, functionName, undefined, undefined)).rejects.toMatchSnapshot()
    })
  })

  describe('gets CloudWatch Logs', () => {
    process.env = {[CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY}
    const FLAGS_WITH_LOGS = [...MOCK_REQUIRED_FLAGS, '--with-logs']

    const mockLogStreamNames = ['Stream1', 'Stream2', 'Stream3']
    const mockLogEvents = [
      {timestamp: 123, message: 'Log1'},
      {timestamp: 456, message: 'Log2'},
    ]

    beforeEach(() => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValue(mockLogStreamNames)
      jest.spyOn(flareModule, 'getLogEvents').mockResolvedValue(mockLogEvents)
    })

    it('gets logs, saves, and sends correctly when --with-logs is included', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(FLAGS_WITH_LOGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('does not get logs when --with-logs is not included', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when getLogStreamNames throws error', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to get log stream names')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(FLAGS_WITH_LOGS, context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('warns and skips getting logs when getLogStreamNames returns []', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValue([])
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(FLAGS_WITH_LOGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when getLogEvents throws error', async () => {
      jest.spyOn(flareModule, 'getLogEvents').mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to get log events')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(FLAGS_WITH_LOGS, context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('warns and skips log when getLogEvents returns []', async () => {
      jest.spyOn(flareModule, 'getLogEvents').mockResolvedValue([])
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(FLAGS_WITH_LOGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('getTags', () => {
    const MOCK_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:my-function'

    afterAll(() => {
      mockResourceTags(lambdaClientMock, MOCK_TAGS)
    })

    it('should return the tags when they exist', async () => {
      const mockTags: any = {Tags: {Key1: 'Value1', Key2: 'Value2'}}

      mockResourceTags(lambdaClientMock, mockTags)

      const tags = await getTags(lambdaClientMock as any, MOCK_REGION, MOCK_ARN)
      expect(tags).toMatchSnapshot()
    })

    it('should return an empty object when there are no tags', async () => {
      const mockTags: any = {Tags: {}}
      mockResourceTags(lambdaClientMock, mockTags)

      const tags = await getTags(lambdaClientMock as any, MOCK_REGION, MOCK_ARN)
      expect(tags).toEqual({})
    })

    it('should throw an error when the command fails', async () => {
      const errorMessage = 'Unable to get resource tags: Test Error'
      lambdaClientMock.on(ListTagsCommand).rejects(new Error('Test Error'))

      await expect(getTags(lambdaClientMock as any, MOCK_REGION, MOCK_ARN)).rejects.toThrow(errorMessage)
    })
  })

  describe('convertToCSV', () => {
    it('returns a CSV string from an array of log events', () => {
      const mockLogEvents: OutputLogEvent[] = [
        {timestamp: 123, message: 'Log 1'},
        {timestamp: 456, message: 'Log 2'},
      ]

      expect(convertToCSV(mockLogEvents)).toMatchSnapshot()
    })

    it('handles missing timestamp and message in log events', () => {
      const mockLogEvents: OutputLogEvent[] = [
        {timestamp: undefined, message: 'Log 1'},
        {timestamp: 456, message: undefined},
      ]

      expect(convertToCSV(mockLogEvents)).toMatchSnapshot()
    })

    it('returns a CSV string with only headers when given an empty array', () => {
      const mockLogEvents: OutputLogEvent[] = []
      expect(convertToCSV(mockLogEvents)).toMatchSnapshot()
    })
  })

  describe('getFramework', () => {
    it('returns Serverless Framework when serverless.yml exists', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValueOnce(['serverless.yml', 'test.js'])
      expect(getFramework()).toBe(DeploymentFrameworks.ServerlessFramework)
    })

    it('returns AWS CDK when cdk.json exists', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValueOnce(['abc.md', 'Dockerfile', 'cdk.json'])
      expect(getFramework()).toBe(DeploymentFrameworks.AwsCdk)
    })

    it('returns AWS CloudFormation when template.yaml exists', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValueOnce(['abc.md', 'template.yaml', 'Dockerfile'])
      expect(getFramework()).toBe(DeploymentFrameworks.AwsCloudFormation)
    })

    it('returns Unknown when no framework files exist', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValueOnce(['abc.md', 'Dockerfile', 'test.js', 'README.md'])
      expect(getFramework()).toBe(DeploymentFrameworks.Unknown)
    })

    it('returns multiple frameworks when multiple are found', () => {
      ;(fs.readdirSync as jest.Mock).mockReturnValueOnce(['serverless.yml', 'cdk.json', 'Dockerfile'])
      expect(getFramework()).toBe(`${DeploymentFrameworks.ServerlessFramework}, ${DeploymentFrameworks.AwsCdk}`)
    })
  })

  describe('generateInsightsFile', () => {
    const insightsFilePath = 'mock/INSIGHTS.md'
    const writeFileSpy = jest.spyOn(fsModule, 'writeFile')

    it('should call writeFile with correct content when isDryRun is false', () => {
      generateInsightsFile(insightsFilePath, false, maskConfig(MOCK_LAMBDA_CONFIG))

      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      const receivedContent = writeFileSpy.mock.calls[0][1]
      expect(receivedContent).toMatchSnapshot()
    })

    it('should call writeFile with correct content when isDryRun is true', () => {
      generateInsightsFile(insightsFilePath, true, maskConfig(MOCK_LAMBDA_CONFIG))

      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      const receivedContent = writeFileSpy.mock.calls[0][1]
      expect(receivedContent).toMatchSnapshot()
    })
  })

  describe('AWS Lambda configuration', () => {
    it('stops and prints error when getLambdaFunctionConfig fails', async () => {
      ;(getLambdaFunctionConfig as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Some API error')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints config when running as a dry run', async () => {
      ;(getLambdaFunctionConfig as any).mockImplementation(() => Promise.resolve(MOCK_LAMBDA_CONFIG))
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '-d'], context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('AWS credentials', () => {
    it('continues when getAWSCredentials() returns valid credentials', async () => {
      ;(getAWSCredentials as any).mockResolvedValue(mockAwsCredentials)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(requestAWSCredentials).not.toHaveBeenCalled()
    })

    it('requests AWS credentials when none are found by getAWSCredentials()', async () => {
      ;(getAWSCredentials as any).mockResolvedValue(undefined)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(requestAWSCredentials).toHaveBeenCalled()
    })

    it('stops and prints error when getAWSCredentials() fails', async () => {
      ;(getAWSCredentials as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Error getting AWS credentials')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('stops and prints error when requestAWSCredentials() fails', async () => {
      ;(getAWSCredentials as any).mockResolvedValue(undefined)
      ;(requestAWSCredentials as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Error requesting AWS credentials')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(requestAWSCredentials).toHaveBeenCalled()
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('prompts for confirmation before sending', () => {
    beforeEach(() => {
      ;(getAWSCredentials as any).mockResolvedValue(mockAwsCredentials)
    })

    it('sends when user answers prompt with yes', async () => {
      // The first prompt is for additional files, the second is for confirmation before sending
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('✅ Successfully sent flare file to Datadog Support!')
    })

    it('does not send when user answers prompt with no', async () => {
      // The first prompt is for additional files, the second is for confirmation before sending
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('🚫 The flare files were not sent based on your selection.')
    })
  })

  describe('prompts for additional files', () => {
    beforeEach(() => {
      ;(getAWSCredentials as any).mockResolvedValue(mockAwsCredentials)
    })

    it('requests additional files when user answers yes', async () => {
      // The first prompt is for additional files, the second is for confirmation before sending
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('Added 0 custom file(s)')
    })

    it('does not request additional files when user answers no', async () => {
      // The first prompt is for additional files, the second is for confirmation before sending
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).not.toContain('Added 0 custom file(s)')
    })
  })

  describe('getProjectFiles', () => {
    beforeAll(() => {
      ;(flareModule.getProjectFiles as jest.Mock).mockRestore()
      ;(process.cwd as jest.Mock).mockReturnValue('')
    })

    it('should return a map of existing project files', async () => {
      const mockProjectFiles = ['serverless.yml', 'package.json']
      ;(fs.existsSync as jest.Mock).mockImplementation((filePath: string) => mockProjectFiles.includes(filePath))

      const result = await getProjectFiles()
      expect(Array.from(result.keys())).toEqual(mockProjectFiles)
      expect(fs.existsSync).toHaveBeenCalledTimes(PROJECT_FILES.length)
    })

    it('should return an empty map when no files exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const result = await getProjectFiles()
      expect(result).toEqual(new Set())
      expect(fs.existsSync).toHaveBeenCalledTimes(PROJECT_FILES.length)
    })
  })

  describe('getUniqueFilesNames', () => {
    it('should return file names when all are unique', () => {
      const mockFilePaths = new Set<string>(['src/serverless.yml', 'src/package.json'])
      const expectedFiles = new Map([
        ['src/serverless.yml', 'serverless.yml'],
        ['src/package.json', 'package.json'],
      ])
      const result = getUniqueFileNames(mockFilePaths)
      expect(result).toEqual(expectedFiles)
    })

    it('returns unique file names when there are duplicates', () => {
      const mockFilePaths = new Set<string>([
        'src/func1/serverless.yml',
        'src/func2/serverless.yml',
        'src/func1/package.json',
        'src/func2/package.json',
        'src/Dockerfile',
        'src/README.md',
      ])

      const expectedFiles = new Map([
        ['src/func1/serverless.yml', 'src-func1-serverless.yml'],
        ['src/func2/serverless.yml', 'src-func2-serverless.yml'],
        ['src/func1/package.json', 'src-func1-package.json'],
        ['src/func2/package.json', 'src-func2-package.json'],
        ['src/Dockerfile', 'Dockerfile'],
        ['src/README.md', 'README.md'],
      ])

      const result = getUniqueFileNames(mockFilePaths)
      expect(result).toEqual(expectedFiles)
    })

    it('returns unique file names when there are duplicates with different prefixes', () => {
      const mockFilePaths = new Set<string>([
        'project1/src/func1/serverless.yml',
        'project1/src/func2/serverless.yml',
        'project2/src/func1/serverless.yml',
        'project2/src/func2/serverless.yml',
        'project2/src/func3/serverless.yml',
        'project3/src/cool_function/serverless.yml',
        'src/Dockerfile',
        'src/README.md',
      ])

      const expectedFiles = new Map([
        ['project1/src/func1/serverless.yml', 'project1-src-func1-serverless.yml'],
        ['project1/src/func2/serverless.yml', 'project1-src-func2-serverless.yml'],
        ['project2/src/func1/serverless.yml', 'project2-src-func1-serverless.yml'],
        ['project2/src/func2/serverless.yml', 'project2-src-func2-serverless.yml'],
        ['project2/src/func3/serverless.yml', 'project2-src-func3-serverless.yml'],
        ['project3/src/cool_function/serverless.yml', 'project3-src-cool_function-serverless.yml'],
        ['src/Dockerfile', 'Dockerfile'],
        ['src/README.md', 'README.md'],
      ])

      const result = getUniqueFileNames(mockFilePaths)
      expect(result).toEqual(expectedFiles)
    })
  })
})
