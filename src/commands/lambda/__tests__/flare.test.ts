import fs from 'fs'
import path from 'path'
import process from 'process'
import * as stream from 'stream'

import {CloudWatchLogsClient, LogStream, OutputLogEvent} from '@aws-sdk/client-cloudwatch-logs'
import {mockClient} from 'aws-sdk-client-mock'
import axios from 'axios'
import FormData from 'form-data'
import JSZip from 'jszip'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from '../constants'
import {
  convertToCSV,
  createDirectories,
  deleteFolder,
  getAllLogs,
  getLogEvents,
  getLogStreamNames,
  writeFile,
  zipContents,
} from '../flare'
import * as flareModule from '../flare'
import {getAWSCredentials, getLambdaFunctionConfig} from '../functions/commons'
import {requestAWSCredentials} from '../prompt'

import {
  createMockContext,
  makeCli,
  mockAwsCredentials,
  mockCloudWatchLogEvents,
  mockCloudWatchLogsClientCommands,
  mockCloudWatchStreams,
  mockDatadogApiKey,
} from './fixtures'

// Constants
const MOCK_CWD = 'mock-folder'
const MOCK_FOLDER_NAME = '.datadog-ci'
const MOCK_FOLDER_PATH = path.join(MOCK_CWD, MOCK_FOLDER_NAME)
const MOCK_FILE_NAME = 'function_config.json'
const MOCK_FILES = new Set([MOCK_FILE_NAME, 'file1.csv', 'file2.csv', 'file3.csv'])
const MOCK_ZIP_PATH = 'output.zip'
const MOCK_REQUIRED_FLAGS = ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com']
const MOCK_CONFIG = {
  Environment: {
    Variables: {
      DD_API_KEY: mockDatadogApiKey,
      DD_SITE: 'datadoghq.com',
      DD_LOG_LEVEL: 'debug',
    },
  },
  FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:some-function',
  FunctionName: 'some-function',
}
const MOCK_LOG_GROUP = 'mockLogGroup'
const MOCK_OUTPUT_EVENT: OutputLogEvent[] = [{timestamp: 123, message: 'Log 1'}]
const MOCK_LOGS = new Map().set('log1', MOCK_OUTPUT_EVENT)
const CLOUDWATCH_CLIENT_MOCK = mockClient(CloudWatchLogsClient)

// Commons mocks
jest.mock('../functions/commons', () => ({
  ...jest.requireActual('../functions/commons'),
  getAWSCredentials: jest.fn(),
  getLambdaFunctionConfig: jest.fn().mockImplementation(() => Promise.resolve(MOCK_CONFIG)),
}))
jest.mock('../prompt')
jest.mock('util')

// File system mocks
process.cwd = jest.fn().mockReturnValue(MOCK_CWD)
jest.mock('fs')
fs.writeFileSync = jest.fn().mockImplementation(() => {})
fs.readFileSync = jest.fn().mockReturnValue(JSON.stringify(MOCK_CONFIG, undefined, 2))
const mockReadStream = new stream.Readable({
  read() {
    this.push(JSON.stringify(MOCK_CONFIG, undefined, 2))
    this.push(undefined)
  },
})
fs.createReadStream = jest.fn().mockReturnValue(mockReadStream)
;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
  isDirectory: () => file_path === MOCK_FOLDER_PATH || file_path === MOCK_CWD,
}))

// Zip mocks
jest.mock('jszip')
const mockJSZip = {
  file: jest.fn(),
  generateAsync: jest.fn().mockResolvedValue('zip content'),
}
;(JSZip as any).mockImplementation(() => mockJSZip)

describe('lambda flare', () => {
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
      process.env = {[CI_API_KEY_ENV_VAR]: mockDatadogApiKey}
    })

    it('prints error when no function specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['lambda', 'flare', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
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
          'arn:aws:lambda:us-west-2:123456789012:function:my-function',
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
        ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('uses API key ENV variable and runs as expected', async () => {
      process.env = {}
      process.env[CI_API_KEY_ENV_VAR] = mockDatadogApiKey
      process.env[API_KEY_ENV_VAR] = undefined
      const cli = makeCli()
      const context = createMockContext()
      let code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(0)
      let output = context.stdout.toString()
      expect(output).toMatchSnapshot()

      process.env[CI_API_KEY_ENV_VAR] = undefined
      process.env[API_KEY_ENV_VAR] = mockDatadogApiKey
      code = await cli.run(
        ['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-c', '123', '-e', 'test@test.com'],
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
        ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no email specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123'], context as any)
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
  })

  describe('deleteFolder', () => {
    it('successfully deletes a folder', async () => {
      deleteFolder(MOCK_FOLDER_PATH)

      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH, {recursive: true, force: true})
    })

    it('throws error when unable to delete a folder', async () => {
      ;(fs.rmSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to delete folder')
      })

      expect(() => deleteFolder(MOCK_FOLDER_PATH)).toThrowErrorMatchingSnapshot()
      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH, {recursive: true, force: true})
      ;(fs.rmSync as jest.Mock).mockRestore()
    })
  })

  describe('createDirectories', () => {
    const MOCK_LOG_PATH = path.join(MOCK_FOLDER_PATH, 'logs')
    it('successfully creates a root folder', async () => {
      createDirectories(MOCK_FOLDER_PATH, MOCK_LOG_PATH, new Map())

      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
    })

    it('successfully creates a root and logs folder', async () => {
      createDirectories(MOCK_FOLDER_PATH, MOCK_LOG_PATH, MOCK_LOGS)

      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_LOG_PATH)
    })

    it('throws error when unable to create a folder', async () => {
      ;(fs.mkdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to create folder')
      })

      expect(() => createDirectories(MOCK_FOLDER_PATH, MOCK_LOG_PATH, new Map())).toThrowErrorMatchingSnapshot()
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      fs.mkdirSync = jest.fn().mockImplementation(() => {})
    })
  })

  describe('getLogStreamNames', () => {
    beforeEach(() => {
      CLOUDWATCH_CLIENT_MOCK.reset()
      mockCloudWatchLogsClientCommands(CLOUDWATCH_CLIENT_MOCK)
    })

    it('returns the 3 latest log stream names sorted by last event time', async () => {
      const mockStreams: LogStream[] = [
        {logStreamName: 'Stream3'},
        {logStreamName: 'Stream2'},
        {logStreamName: 'Stream1'},
      ]
      mockCloudWatchStreams(CLOUDWATCH_CLIENT_MOCK, mockStreams)

      const expectedLogStreams = ['Stream1', 'Stream2', 'Stream3']
      const logStreams = await getLogStreamNames(new CloudWatchLogsClient({}), MOCK_LOG_GROUP)

      expect(logStreams).toEqual(expectedLogStreams)
    })

    it('returns undefined when no log streams are found', async () => {
      mockCloudWatchStreams(CLOUDWATCH_CLIENT_MOCK, [])

      const logStreams = await getLogStreamNames(new CloudWatchLogsClient({}), MOCK_LOG_GROUP)

      expect(logStreams).toEqual([])
    })

    it('throws error when log streams cannot be retrieved', async () => {
      mockCloudWatchStreams(CLOUDWATCH_CLIENT_MOCK, [])
      const mockCwlClient = {
        send: jest.fn().mockRejectedValue(new Error('Cannot retrieve log streams')),
      }

      await expect(
        getLogStreamNames((mockCwlClient as unknown) as CloudWatchLogsClient, MOCK_LOG_GROUP)
      ).rejects.toThrow('Cannot retrieve log streams')
      expect(mockCwlClient.send).toHaveBeenCalled()
    })
  })

  describe('getLogEvents', () => {
    beforeEach(() => {
      CLOUDWATCH_CLIENT_MOCK.reset()
      mockCloudWatchLogsClientCommands(CLOUDWATCH_CLIENT_MOCK)
    })

    const MOCK_LOG_STREAM = 'mockLogStream'
    it('returns the log events for a log stream', async () => {
      mockCloudWatchLogEvents(CLOUDWATCH_CLIENT_MOCK, [
        {timestamp: 123, message: 'Log1'},
        {timestamp: 456, message: 'Log2'},
      ])

      const expectedEvents = [
        {timestamp: 123, message: 'Log1'},
        {timestamp: 456, message: 'Log2'},
      ]

      const logEvents = await getLogEvents(
        (CLOUDWATCH_CLIENT_MOCK as unknown) as CloudWatchLogsClient,
        MOCK_LOG_GROUP,
        MOCK_LOG_STREAM
      )

      expect(logEvents).toEqual(expectedEvents)
    })

    it('returns undefined when no log events are found', async () => {
      mockCloudWatchLogEvents(CLOUDWATCH_CLIENT_MOCK, [])

      const logEvents = await getLogEvents(
        (CLOUDWATCH_CLIENT_MOCK as unknown) as CloudWatchLogsClient,
        MOCK_LOG_GROUP,
        MOCK_LOG_STREAM
      )

      expect(logEvents).toEqual([])
    })

    it('throws error when log events cannot be retrieved', async () => {
      const mockCwlClient = {
        send: jest.fn().mockRejectedValue(new Error('Cannot retrieve log events')),
      }
      await expect(
        getLogEvents((mockCwlClient as unknown) as CloudWatchLogsClient, MOCK_LOG_GROUP, MOCK_LOG_STREAM)
      ).rejects.toThrow('Cannot retrieve log events')
      expect(mockCwlClient.send).toHaveBeenCalled()
    })
  })

  describe('getAllLogs', () => {
    const region = 'us-east-1'
    const functionName = 'testFunction'
    const mockStreamName = 'streamName'

    it('returns a map of log streams and their events', async () => {
      const mockLogs = [
        {timestamp: 123, message: 'log message 1'},
        {timestamp: 124, message: 'log message 2'},
      ] as OutputLogEvent[]

      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValue([mockStreamName])
      jest.spyOn(flareModule, 'getLogEvents').mockResolvedValue(mockLogs)

      const result = await getAllLogs(region, functionName)
      expect(result.get(mockStreamName)).toEqual(mockLogs)
    })

    it('throws an error when unable to get log streams', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockRejectedValueOnce(new Error('Error getting log streams'))

      await expect(getAllLogs(region, functionName)).rejects.toMatchSnapshot()
    })

    it('throws an error when unable to get log events', async () => {
      jest.spyOn(flareModule, 'getLogStreamNames').mockResolvedValueOnce([mockStreamName])
      jest.spyOn(flareModule, 'getLogEvents').mockRejectedValueOnce(new Error('Error getting log events'))

      await expect(getAllLogs(region, functionName)).rejects.toMatchSnapshot()
    })
  })

  describe('gets CloudWatch Logs', () => {
    process.env = {[CI_API_KEY_ENV_VAR]: mockDatadogApiKey}
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

  describe('writeFile', () => {
    const MOCK_DATA = 'mock data'
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    it('successfully writes data to a file with no error', async () => {
      writeFile(MOCK_FILE_NAME, MOCK_DATA)

      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_NAME, MOCK_DATA)
    })

    it('throws error when unable to write data to a file', async () => {
      ;(fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      expect(() => writeFile(MOCK_FILE_NAME, MOCK_DATA)).toThrowErrorMatchingSnapshot()
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_NAME, MOCK_DATA)
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
    })
  })

  describe('convertToCSV', () => {
    it('returns a CSV string from an array of log events', () => {
      const mockLogEvents: OutputLogEvent[] = [
        {timestamp: 123, message: 'Log 1'},
        {timestamp: 456, message: 'Log 2'},
      ]

      const expectedCSV = 'timestamp,message\n"123","Log 1"\n"456","Log 2"'
      expect(convertToCSV(mockLogEvents)).toBe(expectedCSV)
    })

    it('handles missing timestamp and message in log events', () => {
      const mockLogEvents: OutputLogEvent[] = [
        {timestamp: undefined, message: 'Log 1'},
        {timestamp: 456, message: undefined},
      ]

      const expectedCSV = 'timestamp,message\n"","Log 1"\n"456",""'
      expect(convertToCSV(mockLogEvents)).toBe(expectedCSV)
    })

    it('returns a CSV string with only headers when given an empty array', () => {
      const mockLogEvents: OutputLogEvent[] = []
      const expectedCSV = 'timestamp,message'
      expect(convertToCSV(mockLogEvents)).toBe(expectedCSV)
    })
  })

  describe('zipContents', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as jest.Mock).mockImplementation((file_path: string) =>
      file_path === MOCK_FOLDER_PATH ? Array.from(MOCK_FILES) : []
    )

    it('successfully zips the contents of a file', async () => {
      await zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)

      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.readdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_ZIP_PATH, 'zip content')
    })

    it('throws error when path is not found', async () => {
      ;(fs.existsSync as any).mockReturnValue(false)

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.existsSync as any).mockReturnValue(true)
    })

    it('throws error when path is not a directory', async () => {
      ;(fs.statSync as any).mockReturnValue({isDirectory: () => false})

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
        isDirectory: () => file_path === MOCK_FOLDER_PATH || file_path === MOCK_CWD,
      }))
    })

    it('throws error when unable to read file', async () => {
      ;(fs.readFileSync as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to read file')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalled()
      expect(mockJSZip.file).not.toHaveBeenCalled()
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.readFileSync as any).mockReturnValue(JSON.stringify(MOCK_CONFIG, undefined, 2))
    })

    it('throws error when unable to write file', async () => {
      ;(mockJSZip.file as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalled()
      expect(mockJSZip.file).toHaveBeenCalled()
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(mockJSZip.file as any).mockImplementation(() => {})
    })

    it('throws error when unable to generate zip', async () => {
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to generate zip')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalled()
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => 'zip content')
    })

    it('throws error when unable to save zip', async () => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to save zip')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalled()

      // Reset mock
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
    })
  })

  describe('send to Datadog', () => {
    // File system mocks
    beforeAll(() => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
      fs.mkdirSync = jest.fn().mockImplementation(() => {})
    })
    process.env = {['DATADOG_API_KEY']: mockDatadogApiKey}

    it('successfully adds zip file to FormData', async () => {
      const appendSpy = jest.spyOn(FormData.prototype, 'append')
      const cli = makeCli()
      const context = createMockContext()
      await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(appendSpy).toHaveBeenCalled()
      appendSpy.mockRestore()
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('successfully sends request to Datadog', async () => {
      const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({status: 200})
      const cli = makeCli()
      const context = createMockContext()
      await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(postSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            'DD-API-KEY': mockDatadogApiKey,
          }),
        })
      )
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      postSpy.mockRestore()
    })

    it('does not send request to Datadog when a dry run', async () => {
      const postSpy = (axios.post = jest.fn().mockRejectedValue({status: 500}))
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '-d'], context as any)
      expect(code).toBe(0)
      expect(postSpy).not.toHaveBeenCalled()
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      postSpy.mockRestore()
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
      ;(getLambdaFunctionConfig as any).mockImplementation(() => Promise.resolve(MOCK_CONFIG))
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
})
