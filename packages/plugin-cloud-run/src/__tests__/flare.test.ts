import fs from 'fs'
import process from 'process'
import stream from 'stream'

import {
  makeRunCLI,
  MOCK_CWD,
  MOCK_DATADOG_API_KEY,
  MOCK_FLARE_FOLDER_PATH,
} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as fsModule from '@datadog/datadog-ci-base/helpers/fs'
import * as helpersPromptModule from '@datadog/datadog-ci-base/helpers/prompt'
import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import * as helpersFlareModule from '@datadog/datadog-ci-base/helpers/serverless/flare'
import {Logging} from '@google-cloud/logging'
import {GoogleAuth} from 'google-auth-library'

import * as flareModule from '../commands/flare'
import {
  generateInsightsFile,
  getCloudRunServiceConfig,
  getLogs,
  getRecentRevisions,
  maskConfig,
  MAX_LOGS,
  saveLogsFile,
  summarizeConfig,
  PluginCommand as CloudRunFlareCommand,
} from '../commands/flare'
import {checkAuthentication} from '../utils'

const MOCK_REGION = 'us-east1'
const MOCK_SERVICE = 'mock-service'
const MOCK_PROJECT = 'mock-project'
const MOCK_LOG_CLIENT = new Logging({projectId: MOCK_PROJECT})
const MOCK_REQUIRED_FLAGS = [
  '-s',
  MOCK_SERVICE,
  '-p',
  MOCK_PROJECT,
  '-r',
  MOCK_REGION,
  '-c',
  '123',
  '-e',
  'test@test.com',
]
const MOCK_CLOUDRUN_CONFIG = {
  name: `projects/${MOCK_PROJECT}/locations/${MOCK_REGION}/services/${MOCK_SERVICE}`,
  description: 'description',
  uid: 'abc1234-def5678',
  uri: `https://${MOCK_SERVICE}-abc12345-ue.a.run.app`,
  labels: {
    someLabel: 'someValue',
    anotherLabel: 'anotherValue',
  },
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
const MOCK_REVISION_TIMESTAMP = {seconds: 100}
const MOCK_REVISIONS = [
  {
    name: 'projects/some-project/locations/some-location/services/service/revisions/service-00005-abc',
    createTime: MOCK_REVISION_TIMESTAMP,
  },
  {
    name: 'projects/some-project/locations/some-location/services/service/revisions/service-00004-def',
    createTime: MOCK_REVISION_TIMESTAMP,
  },
  {
    name: 'projects/some-project/locations/some-location/services/service/revisions/service-00003-ghi',
    createTime: MOCK_REVISION_TIMESTAMP,
  },
  {
    name: 'projects/some-project/locations/some-location/services/service/revisions/service-00002-jkl',
    createTime: MOCK_REVISION_TIMESTAMP,
  },
  {
    name: 'projects/some-project/locations/some-location/services/service/revisions/service-00001-mno',
    createTime: MOCK_REVISION_TIMESTAMP,
  },
]
const MOCK_REVISION_NAMES = [
  '`service-00005-abc` Deployed on 1970-01-01 00:01:40',
  '`service-00004-def` Deployed on 1970-01-01 00:01:40',
  '`service-00003-ghi` Deployed on 1970-01-01 00:01:40',
  '`service-00002-jkl` Deployed on 1970-01-01 00:01:40',
  '`service-00001-mno` Deployed on 1970-01-01 00:01:40',
]

// GCP mocks
jest.mock('@google-cloud/logging')
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
    RevisionsClient: jest.fn().mockImplementation(() => ({
      servicePath: jest.fn().mockReturnValue('servicePath'),
      listRevisions: jest.fn().mockReturnValue([MOCK_REVISIONS]),
    })),
  }
})

// Prompt mocks
jest.spyOn(helpersPromptModule, 'requestFilePath').mockResolvedValue('')
jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValue(true)
jest.spyOn(helpersFlareModule, 'getProjectFiles').mockResolvedValue(new Set())
jest.spyOn(helpersFlareModule, 'validateCliVersion').mockResolvedValue()

// Misc
jest.mock('axios')
jest.mock('jszip')
jest.mock('@google-cloud/logging')
jest.useFakeTimers({now: new Date(Date.UTC(2023, 0))})
jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: '1.0-mock-version'}))

// File system mocks
jest.spyOn(process, 'cwd').mockReturnValue(MOCK_CWD)
jest.mock('fs')
fs.existsSync = jest.fn().mockReturnValue(true)
;(fs.statSync as jest.Mock).mockImplementation((path: string) => ({
  isDirectory: () => path === MOCK_FLARE_FOLDER_PATH || path === MOCK_CWD,
}))
fs.readdirSync = jest.fn().mockReturnValue([])
fs.createReadStream = jest.fn().mockReturnValue(MOCK_READ_STREAM)

describe('cloud-run flare', () => {
  const runCLI = makeRunCLI(CloudRunFlareCommand, ['cloud-run', 'flare'], {
    appendStdoutWithStderr: true,
    skipResetEnv: true,
  })

  describe('prints correct headers', () => {
    beforeEach(() => {
      process.env = {[CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY}
    })

    it('prints non-dry-run header', async () => {
      const {code, context} = await runCLI([])
      const output = context.stdout.toString()
      expect(code).toBe(1)
      expect(output).toMatchSnapshot()
    })

    it('prints dry-run header', async () => {
      const {code, context} = await runCLI(['-d'])
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
      const {code, context} = await runCLI(['-p', MOCK_PROJECT, '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'])
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no project specified', async () => {
      const {code, context} = await runCLI(['-s', MOCK_SERVICE, '-r', MOCK_REGION, '-c', '123', '-e', 'test@test.com'])
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no region specified', async () => {
      const {code, context} = await runCLI(['-s', MOCK_SERVICE, '-p', MOCK_PROJECT, '-c', '123', '-e', 'test@test.com'])
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no case ID specified', async () => {
      const {code, context} = await runCLI([
        '-s',
        MOCK_SERVICE,
        '-p',
        MOCK_PROJECT,
        '-r',
        MOCK_REGION,
        '-e',
        'test@test.com',
      ])
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no email specified', async () => {
      const {code, context} = await runCLI(['-s', MOCK_SERVICE, '-p', MOCK_PROJECT, '-r', MOCK_REGION, '-c', '123'])
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints error when no API key in env variables', async () => {
      process.env = {}
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('uses API key ENV variable and runs as expected', async () => {
      process.env = {}
      process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      process.env[API_KEY_ENV_VAR] = undefined
      let {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(0)
      let output = context.stdout.toString()
      expect(output).toMatchSnapshot()

      process.env[CI_API_KEY_ENV_VAR] = undefined
      process.env[API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      ;({code, context} = await runCLI(MOCK_REQUIRED_FLAGS))
      expect(code).toBe(0)
      output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('runs successfully with all required options specified', async () => {
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })
  })

  describe('checkAuthentication', () => {
    it('should return true when authentication is successful', async () => {
      ;(GoogleAuth as jest.Mock).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.resolve(),
      }))

      const result = await checkAuthentication()
      expect(result).toBeTruthy()
      expect(GoogleAuth).toHaveBeenCalledTimes(1)
    })

    it('should return false when authentication fails', async () => {
      ;(GoogleAuth as jest.Mock).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.reject(),
      }))

      const result = await checkAuthentication()
      expect(result).toBeFalsy()
      expect(GoogleAuth).toHaveBeenCalledTimes(1)
    })

    it('prints instructions on how to authenticate when authentication fails', async () => {
      ;(GoogleAuth as jest.Mock).mockImplementationOnce(() => ({
        getApplicationDefault: () => Promise.reject(),
      }))

      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
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
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
    })

    it('prints config when running as a dry run', async () => {
      ;(getCloudRunServiceConfig as any).mockImplementation(() => Promise.resolve(MOCK_CLOUDRUN_CONFIG))
      const {code, context} = await runCLI([...MOCK_REQUIRED_FLAGS, '-d'])
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

  test('getRecentRevisions should return the correct revision names', async () => {
    const revisions = await getRecentRevisions(MOCK_SERVICE, MOCK_REGION, MOCK_PROJECT)
    expect(revisions).toEqual(MOCK_REVISION_NAMES)
  })

  describe('generateInsightsFile', () => {
    const insightsFilePath = 'mock/INSIGHTS.md'
    const writeFileSpy = jest.spyOn(fsModule, 'writeFile')

    it('should call writeFile with correct content when isDryRun is false', () => {
      generateInsightsFile(
        insightsFilePath,
        false,
        maskConfig(MOCK_CLOUDRUN_CONFIG),
        MOCK_SERVICE,
        MOCK_REGION,
        MOCK_PROJECT,
        MOCK_REVISION_NAMES
      )

      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      const receivedContent = writeFileSpy.mock.calls[0][1]
      expect(receivedContent).toMatchSnapshot()
    })

    it('should call writeFile with correct content when isDryRun is true', () => {
      generateInsightsFile(
        insightsFilePath,
        true,
        maskConfig(MOCK_CLOUDRUN_CONFIG),
        MOCK_SERVICE,
        MOCK_REGION,
        MOCK_PROJECT,
        MOCK_REVISION_NAMES
      )

      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      const receivedContent = writeFileSpy.mock.calls[0][1]
      expect(receivedContent).toMatchSnapshot()
    })

    it('prints a warning when generateInsightsFile() errors', async () => {
      jest.spyOn(flareModule, 'generateInsightsFile').mockImplementationOnce(() => {
        throw new Error('Some error')
      })
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      const output = context.stdout.toString()
      expect(code).toBe(0)
      expect(output).toMatchSnapshot()
    })

    it('splits environment variables when there are multiple containers', async () => {
      // Define a config with multiple containers
      // Deep copy MOCK_CLOUDRUN_CONFIG, and then add another container
      const multipleContainerConfig = JSON.parse(JSON.stringify(MOCK_CLOUDRUN_CONFIG))
      const secondContainer = {
        env: [
          {
            name: 'DD_API_KEY',
            value: MOCK_DATADOG_API_KEY,
            values: 'value',
          },
        ],
        image: 'gcr.io/datadog-sandbox/another-container',
      }
      multipleContainerConfig.template.containers.push(secondContainer)

      generateInsightsFile(
        insightsFilePath,
        false,
        maskConfig(multipleContainerConfig),
        MOCK_SERVICE,
        MOCK_REGION,
        MOCK_PROJECT,
        MOCK_REVISION_NAMES
      )
      expect(writeFileSpy).toHaveBeenCalledTimes(1)
      const receivedContent = writeFileSpy.mock.calls[0][1]
      expect(receivedContent).toMatchSnapshot()
    })
  })

  describe('prompts for confirmation before sending', () => {
    it('sends when user answers prompt with yes', async () => {
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(true)
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('✅ Successfully sent flare file to Datadog Support!')
    })

    it('does not send when user answers prompt with no', async () => {
      // The first prompt is for additional files, the second is for confirmation before sending
      jest.spyOn(helpersPromptModule, 'requestConfirmation').mockResolvedValueOnce(false).mockResolvedValueOnce(false)
      const {code, context} = await runCLI(MOCK_REQUIRED_FLAGS)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toMatchSnapshot()
      expect(output).toContain('🚫 The flare files were not sent based on your selection.')
    })
  })

  describe('getLogs', () => {
    const logName = 'mock-logname'
    const mockLogs = [
      {metadata: {severity: 'DEFAULT', timestamp: '2023-07-28 00:00:00', logName, textPayload: 'Log 1'}},
      {metadata: {severity: 'INFO', timestamp: '2023-07-28 00:00:00', logName, textPayload: 'Log 2'}},
      {metadata: {severity: 'NOTICE', timestamp: '2023-07-28 01:01:01', logName, textPayload: 'Log 3'}},
    ]
    const MOCK_GET_ENTRIES = MOCK_LOG_CLIENT.getEntries as jest.Mock
    MOCK_GET_ENTRIES.mockResolvedValue([mockLogs, {pageToken: undefined}])
    const expectedOrder = 'timestamp asc'

    it('uses correct filter when `severityFilter` is unspecified', async () => {
      await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)
      const expectedFilter = `resource.labels.service_name="${MOCK_SERVICE}" AND resource.labels.location="${MOCK_REGION}" AND timestamp>="2022-12-31T00:00:00.000Z" AND timestamp<="2023-01-01T00:00:00.000Z" AND (textPayload:* OR httpRequest:*)`

      expect(MOCK_LOG_CLIENT.getEntries).toHaveBeenCalledWith({
        filter: expectedFilter,
        orderBy: expectedOrder,
        pageSize: MAX_LOGS,
      })
    })

    it('uses correct filter when `severityFilter` is defined', async () => {
      await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION, undefined, undefined, ' AND severity>="WARNING"')
      const expectedFilter = `resource.labels.service_name="${MOCK_SERVICE}" AND resource.labels.location="${MOCK_REGION}" AND timestamp>="2022-12-31T00:00:00.000Z" AND timestamp<="2023-01-01T00:00:00.000Z" AND (textPayload:* OR httpRequest:*) AND severity>="WARNING"`

      expect(MOCK_LOG_CLIENT.getEntries).toHaveBeenCalledWith({
        filter: expectedFilter,
        orderBy: expectedOrder,
        pageSize: MAX_LOGS,
      })
    })

    it('converts logs to the CloudRunLog interface correctly', async () => {
      const page1 = [
        {metadata: {severity: 'DEFAULT', timestamp: '2023-07-28 00:00:00', logName, textPayload: 'Test log'}},
      ]
      MOCK_GET_ENTRIES.mockResolvedValueOnce([page1, {pageToken: undefined}])

      const logs = await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)

      expect(logs).toEqual([
        {
          severity: 'DEFAULT',
          timestamp: '2023-07-28 00:00:00',
          logName,
          message: '"Test log"',
        },
      ])
    })

    it('throws an error when `getEntries` fails', async () => {
      const error = new Error('getEntries failed')
      MOCK_GET_ENTRIES.mockRejectedValueOnce(error)

      await expect(getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)).rejects.toMatchSnapshot()
    })

    it('returns an empty array when no logs are returned', async () => {
      MOCK_GET_ENTRIES.mockResolvedValueOnce([[], {pageToken: undefined}])
      const logs = await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)

      expect(logs).toEqual([])
    })

    it('handles httpRequest payload correctly', async () => {
      const page = [
        {
          metadata: {
            severity: 'DEFAULT',
            timestamp: '2023-07-28 00:00:00',
            logName,
            httpRequest: {
              requestMethod: 'GET',
              status: 200,
              responseSize: '1300',
              latency: {seconds: '1', nanos: '500000000'},
              requestUrl: '/test-endpoint',
            },
          },
        },
      ]
      MOCK_GET_ENTRIES.mockResolvedValueOnce([page, {pageToken: undefined}])

      const logs = await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)
      expect(logs).toMatchSnapshot()
    })

    it('handles textPayload correctly', async () => {
      const page = [
        {
          metadata: {
            severity: 'DEFAULT',
            timestamp: '2023-07-28 00:00:00',
            logName,
            textPayload: 'Some text payload',
          },
        },
      ]
      MOCK_GET_ENTRIES.mockResolvedValueOnce([page, {pageToken: undefined}])

      const logs = await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)
      expect(logs).toMatchSnapshot()
    })

    it('handles when a log is an HTTP request and has a textPayload', async () => {
      const page = [
        {metadata: {severity: 'DEFAULT', timestamp: '2023-07-28 00:00:00', logName, textPayload: 'Test log 1'}},
        {
          metadata: {
            httpRequest: {
              status: 504,
            },
            timestamp: '2023-07-28 00:00:01',
            logName,
            textPayload: 'some text payload.',
          },
        },
      ]
      MOCK_GET_ENTRIES.mockResolvedValueOnce([page, {pageToken: undefined}])

      const logs = await getLogs(MOCK_LOG_CLIENT, MOCK_SERVICE, MOCK_REGION)

      expect(logs).toMatchSnapshot()
    })
  })

  describe('saveLogsFile', () => {
    const mockLogs = [
      {severity: 'DEFAULT', timestamp: '2023-07-28 00:00:00', logName: 'mock-logname', message: 'Test log 1'},
      {severity: 'INFO', timestamp: '2023-07-28 00:00:01', logName: 'mock-logname', message: 'Test log 2'},
      {severity: 'NOTICE', timestamp: '2023-07-28 01:01:01', logName: 'mock-logname', message: 'Test log 3'},
    ]
    const writeFileSpy = jest.spyOn(fsModule, 'writeFile')
    const mockFilePath = 'path/to/logs.csv'

    it('should save logs to file correctly', () => {
      saveLogsFile(mockLogs, mockFilePath)
      const expectedContent = [
        'severity,timestamp,logName,message',
        '"DEFAULT","2023-07-28 00:00:00","mock-logname","Test log 1"',
        '"INFO","2023-07-28 00:00:01","mock-logname","Test log 2"',
        '"NOTICE","2023-07-28 01:01:01","mock-logname","Test log 3"',
      ].join('\n')
      expect(writeFileSpy).toHaveBeenCalledWith(mockFilePath, expectedContent)
    })
  })

  test('summarizeConfig', () => {
    expect(summarizeConfig(MOCK_CLOUDRUN_CONFIG)).toMatchSnapshot()
  })
})
