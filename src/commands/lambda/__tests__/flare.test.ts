import fs from 'fs'
import process from 'process'
import * as stream from 'stream'
import util, {InspectOptions} from 'util'

import axios from 'axios'
import FormData from 'form-data'
import JSZip from 'jszip'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from '../constants'
import {LambdaFlareCommand, writeFile, zipContents} from '../flare'
import {requestAWSCredentials} from '../prompt'

import {createMockContext, makeCli, mockAwsCredentials} from './fixtures'

// Constants
const MOCK_FOLDER_PATH = './mock_folder'
const MOCK_FILE_PATH = 'function_config.json'
const MOCK_ZIP_PATH = 'output.zip'
const MOCK_API_KEY = 'test-api-key'
const VALID_INPUT = ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com']
const MOCK_CONFIG = {
  Environment: {
    Variables: {
      DD_API_KEY: MOCK_API_KEY,
      DD_SITE: 'datadoghq.com',
      DD_LOG_LEVEL: 'debug',
    },
  },
  FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:some-function',
  FunctionName: 'some-function',
}

// Mock util.inspect to remove color codes
const originalInspect = util.inspect
jest.spyOn(util, 'inspect').mockImplementation((object: any, options?: InspectOptions) => {
  return originalInspect(object, {...options, colors: false})
})

// Commons mocks
jest.mock('../functions/commons', () => ({
  getAWSCredentials: jest.fn(),
  getLambdaFunctionConfig: jest.fn().mockImplementation(() => Promise.resolve(MOCK_CONFIG)),
  getRegion: jest.requireActual('../functions/commons').getRegion as () => string | undefined,
}))
jest.mock('../prompt')

// File system mocks
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

// Zip mocks
jest.mock('jszip')
const mockJSZip = new JSZip()
require('jszip').mockImplementation(() => mockJSZip)

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
      process.env = {[CI_API_KEY_ENV_VAR]: MOCK_API_KEY}
    })

    it('prints error when no function specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['lambda', 'flare', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no region specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-c', '123', '-e', 'test@test.com'], context as any)
      expect(code).toBe(1)
      const output = context.stderr.toString()
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
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('uses API key ENV variable and runs as expected', async () => {
      process.env = {}
      process.env[CI_API_KEY_ENV_VAR] = MOCK_API_KEY
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
      process.env[API_KEY_ENV_VAR] = MOCK_API_KEY
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
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no email specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123'], context as any)
      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('runs successfully with all required options specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('writeFile', () => {
    const MOCK_DATA = 'mock data'
    const instance = new LambdaFlareCommand()
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    it('successfully writes data to a file with no error', async () => {
      await writeFile(MOCK_FOLDER_PATH, MOCK_FILE_PATH, MOCK_DATA, instance.context)

      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, MOCK_DATA)
    })

    it('throws error when unable to create folder', async () => {
      ;(fs.mkdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to create folder')
      })

      await expect(writeFile(MOCK_FOLDER_PATH, MOCK_FILE_PATH, MOCK_DATA, instance.context)).rejects.toMatchSnapshot()

      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      ;(fs.mkdirSync as jest.Mock).mockRestore()
    })

    it('throws error when unable to write data to a file', async () => {
      ;(fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      await expect(writeFile(MOCK_FOLDER_PATH, MOCK_FILE_PATH, MOCK_DATA, instance.context)).rejects.toMatchSnapshot()

      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, MOCK_DATA)
    })
  })

  describe('zipContents', () => {
    beforeEach(() => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
      fs.readFileSync = jest.fn().mockResolvedValue(JSON.stringify(MOCK_CONFIG, undefined, 2))
      mockJSZip.file = jest.fn().mockImplementation(() => {})
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => {})
    })

    it('successfully zips the contents of a file', async () => {
      await zipContents(MOCK_FILE_PATH, MOCK_ZIP_PATH)

      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8')
      expect(mockJSZip.file).toHaveBeenCalled()
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('throws error when unable to read file', async () => {
      fs.readFileSync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to read file')
      })

      await expect(zipContents(MOCK_FILE_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8')
      expect(mockJSZip.file).not.toHaveBeenCalled()
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('throws error when unable to write file', async () => {
      mockJSZip.file = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      await expect(zipContents(MOCK_FILE_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8')
      expect(mockJSZip.file).toHaveBeenCalledWith(MOCK_FILE_PATH, expect.anything())
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('throws error when unable to generate zip', async () => {
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to generate zip')
      })

      await expect(zipContents(MOCK_FILE_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8')
      expect(mockJSZip.file).toHaveBeenCalledWith(MOCK_FILE_PATH, expect.anything())
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('throws error when unable to save zip', async () => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to save zip')
      })

      await expect(zipContents(MOCK_FILE_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledWith(MOCK_FILE_PATH, 'utf8')
      expect(mockJSZip.file).toHaveBeenCalledWith(MOCK_FILE_PATH, expect.anything())
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('send to Datadog', () => {
    // File system mocks
    beforeAll(() => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
      fs.mkdirSync = jest.fn().mockImplementation(() => {})
    })
    process.env = {['DATADOG_API_KEY']: MOCK_API_KEY}

    it('successfully adds zip file to FormData', async () => {
      const appendSpy = jest.spyOn(FormData.prototype, 'append')
      const cli = makeCli()
      const context = createMockContext()
      await cli.run(VALID_INPUT, context as any)
      expect(appendSpy).toHaveBeenCalled()
      appendSpy.mockRestore()
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('successfully sends request to Datadog', async () => {
      const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({status: 200})
      const cli = makeCli()
      const context = createMockContext()
      await cli.run(VALID_INPUT, context as any)
      expect(postSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            'DD-API-KEY': MOCK_API_KEY,
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
      const code = await cli.run([...VALID_INPUT, '-d'], context as any)
      expect(code).toBe(0)
      expect(postSpy).not.toHaveBeenCalled()
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      postSpy.mockRestore()
    })
  })

  describe('AWS Lambda configuration', () => {
    it('stops and prints error when getLambdaFunctionConfig fails', async () => {
      require('../functions/commons').getLambdaFunctionConfig.mockImplementation(() => {
        throw new Error('MOCK ERROR: Some API error')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints config when running as a dry run', async () => {
      require('../functions/commons').getLambdaFunctionConfig.mockImplementation(() => Promise.resolve(MOCK_CONFIG))
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...VALID_INPUT, '-d'], context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('AWS credentials', () => {
    it('continues when getAWSCredentials() returns valid credentials', async () => {
      require('../functions/commons').getAWSCredentials.mockResolvedValue(mockAwsCredentials)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(requestAWSCredentials).not.toHaveBeenCalled()
    })

    it('requests AWS credentials when none are found by getAWSCredentials()', async () => {
      require('../functions/commons').getAWSCredentials.mockResolvedValue(undefined)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(requestAWSCredentials).toHaveBeenCalled()
    })

    it('stops and prints error when getAWSCredentials() fails', async () => {
      require('../functions/commons').getAWSCredentials.mockImplementation(() => {
        throw new Error('MOCK ERROR: Error getting AWS credentials')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })

    it('stops and prints error when requestAWSCredentials() fails', async () => {
      require('../functions/commons').getAWSCredentials.mockResolvedValue(undefined)
      require('../prompt').requestAWSCredentials.mockImplementation(() => {
        throw new Error('MOCK ERROR: Error requesting AWS credentials')
      })
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(VALID_INPUT, context as any)
      expect(requestAWSCredentials).toHaveBeenCalled()
      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toMatchSnapshot()
    })
  })
})
