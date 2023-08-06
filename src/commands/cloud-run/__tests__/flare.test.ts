import fs from 'fs'
import process from 'process'
import stream from 'stream'

import {GoogleAuth} from 'google-auth-library'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../../constants'
import {
  createMockContext,
  MOCK_CWD,
  MOCK_DATADOG_API_KEY,
  MOCK_FLARE_FOLDER_PATH,
} from '../../../helpers/__tests__/fixtures'
import * as helpersPromptModule from '../../../helpers/prompt'

import * as flareModule from '../flare'
import {checkAuthentication, getCloudRunServiceConfig, maskConfig} from '../flare'

import {makeCli} from './fixtures'

const MOCK_REGION = 'us-east1'
const MOCK_REQUIRED_FLAGS = [
  'cloud-run',
  'flare',
  '-s',
  'service',
  '-p',
  'project',
  '-r',
  MOCK_REGION,
  '-c',
  '123',
  '-e',
  'test@test.com',
]
const MOCK_CLOUDRUN_CONFIG = {
  template: {
    containers: [
      {
        env: [
          {
            name: 'DD_API_KEY',
            value: MOCK_DATADOG_API_KEY,
            values: 'value',
          },
          {
            name: 'DD_TRACE_ENABLED',
            value: 'true',
            values: 'value',
          },
          {
            name: 'DD_SITE',
            value: 'datad0g.com',
            values: 'value',
          },
        ],
        image: 'gcr.io/datadog-sandbox/nicholas-hulston-docker-test',
      },
    ],
    someData: 'data',
  },
}
const MOCK_READ_STREAM = new stream.Readable({
  read() {
    this.push(JSON.stringify(MOCK_CLOUDRUN_CONFIG, undefined, 2))
    this.push(undefined)
  },
})

// Mocks
jest.mock('google-auth-library', () => {
  return {
    GoogleAuth: jest.fn().mockImplementation(() => ({
      getApplicationDefault: () => Promise.resolve(),
    })),
  }
})
jest.mock('@google-cloud/run', () => {
  return {
    ServicesClient: jest.fn().mockImplementation(() => ({
      servicePath: jest.fn().mockReturnValue('servicePath'),
      getService: () => Promise.resolve([MOCK_CLOUDRUN_CONFIG]),
    })),
  }
})
jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValue(true)
jest.mock('util')
jest.mock('jszip')

// File system mocks
process.cwd = jest.fn().mockReturnValue(MOCK_CWD)
jest.mock('fs')
fs.existsSync = jest.fn().mockReturnValue(true)
;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
  isDirectory: () => file_path === MOCK_FLARE_FOLDER_PATH || file_path === MOCK_CWD,
}))
fs.readdirSync = jest.fn().mockReturnValue([])
fs.createReadStream = jest.fn().mockReturnValue(MOCK_READ_STREAM)

describe('cloud-run flare', () => {
  describe('prints correct headers', () => {
    it('prints non-dry-run header', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['cloud-run', 'flare'], context as any)
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchSnapshot()
    })

    it('prints dry-run header', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(['cloud-run', 'flare', '-d'], context as any)
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchSnapshot()
    })
  })

  describe('validates required flags', () => {
    beforeEach(() => {
      process.env = {[CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY}
    })

    it('prints error when no service specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['cloud-run', 'flare', '-p', 'project', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no project specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['cloud-run', 'flare', '-s', 'service', '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no region specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['cloud-run', 'flare', '-s', 'service', '-p', 'project', '-c', '123', '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no case ID specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['cloud-run', 'flare', '-s', 'service', '-p', 'project', '-r', MOCK_REGION, '-e', 'test@test.com'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no email specified', async () => {
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(
        ['cloud-run', 'flare', '-s', 'service', '-p', 'project', '-r', MOCK_REGION, '-c', '123'],
        context as any
      )
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no API key in env variables', async () => {
      process.env = {}
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
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
      let code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      let output = context.stdout.toString()
      expect(output).toMatchSnapshot()

      process.env[CI_API_KEY_ENV_VAR] = undefined
      process.env[API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      output = context.stdout.toString()
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

  describe('checkAuthentication', () => {
    it('should return true when authentication is successful', async () => {
      ;(GoogleAuth as any).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.resolve(),
      }))

      const result = await checkAuthentication()
      expect(result).toBeTruthy()
      expect(GoogleAuth).toHaveBeenCalledTimes(1)
    })

    it('should return false when authentication fails', async () => {
      ;(GoogleAuth as any).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.reject(),
      }))

      const result = await checkAuthentication()
      expect(result).toBeFalsy()
      expect(GoogleAuth).toHaveBeenCalledTimes(1)
    })

    it('prints instructions on how to authenticate when authentication fails', async () => {
      ;(GoogleAuth as any).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.reject(),
      }))

      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('getCloudRunServiceConfig', () => {
    const getConfigSpy = jest.spyOn(flareModule, 'getCloudRunServiceConfig')

    afterAll(() => {
      getConfigSpy.mockRestore()
    })

    it('stops and prints error when getCloudRunServiceConfig fails', async () => {
      ;(getCloudRunServiceConfig as any).mockImplementation(() => {
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
      ;(getCloudRunServiceConfig as any).mockImplementation(() => Promise.resolve(MOCK_CLOUDRUN_CONFIG))
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run([...MOCK_REQUIRED_FLAGS, '-d'], context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('maskConfig', () => {
    it('should mask a Cloud Run config correctly', () => {
      const maskedConfig = maskConfig(MOCK_CLOUDRUN_CONFIG)
      expect(maskedConfig).toMatchSnapshot()
    })

    it('should not modify config if env vars are missing', () => {
      const cloudrunConfigCopy = JSON.parse(JSON.stringify(MOCK_CLOUDRUN_CONFIG))
      delete cloudrunConfigCopy.template.containers
      const maskedConfig = maskConfig(cloudrunConfigCopy)
      expect(maskedConfig).toMatchSnapshot()
    })
  })

  describe('prompts for confirmation before sending', () => {
    it('sends when user answers prompt with yes', async () => {
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(true)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('✅ Successfully sent flare file to Datadog Support!')
    })

    it('does not send when user answers prompt with no', async () => {
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(false)
      const cli = makeCli()
      const context = createMockContext()
      const code = await cli.run(MOCK_REQUIRED_FLAGS, context as any)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('🚫 The flare files were not sent based on your selection.')
    })
  })
})
