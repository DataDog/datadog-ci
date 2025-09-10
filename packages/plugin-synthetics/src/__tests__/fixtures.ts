import * as http from 'http'
import * as net from 'net'
import {URL} from 'url'

import {Metadata} from '@datadog/datadog-ci-base/helpers/interfaces'
import {ProxyConfiguration} from '@datadog/datadog-ci-base/helpers/utils'
import WebSocket, {Server as WebSocketServer} from 'ws'

import {APIHelper, apiConstructor} from '../api'
import {
  ApiServerResult,
  BaseResult,
  Batch,
  BrowserServerResult,
  ExecutionRule,
  Location,
  MainReporter,
  MultiStep,
  MultiStepsServerResult,
  MobileApplicationUploadPart,
  MultipartPresignedUrlsResponse,
  Result,
  RunTestsCommandConfig,
  SelectiveRerunDecision,
  Step,
  Suite,
  Summary,
  TestPayload,
  ServerTrigger,
  UploadApplicationCommandConfig,
  MobileAppUploadResult,
  MobileApplicationUploadPartResponse,
  TriggerConfig,
  MobileTestWithOverride,
  BaseResultInBatch,
  ResultInBatchSkippedBySelectiveRerun,
  ServerResult,
  APIConfiguration,
  ServerTest,
  LocalTestDefinition,
  TriggerInfo,
} from '../interfaces'
import {AppUploadReporter} from '../reporters/mobile/app-upload'
import {createInitialSummary} from '../utils/public'

export type MockedReporter = {
  [K in keyof MainReporter]: jest.Mock<void, Parameters<MainReporter[K]>>
}

export const mockReporter: MainReporter = {
  error: jest.fn(),
  initErrors: jest.fn(),
  log: jest.fn(),
  reportStart: jest.fn(),
  resultEnd: jest.fn(),
  resultReceived: jest.fn(),
  runEnd: jest.fn(),
  testTrigger: jest.fn(),
  testWait: jest.fn(),
  testsWait: jest.fn(),
}

export const ciConfig: RunTestsCommandConfig = {
  apiKey: '',
  appKey: '',
  batchTimeout: 2 * 60 * 1000,
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: [],
  jUnitReport: '',
  defaultTestOverrides: {},
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
  testSearchQuery: '',
  tunnel: false,
}

export const getApiLocalTestDefinition = (
  publicId = 'abc-def-ghi',
  opts: Partial<LocalTestDefinition> = {}
): LocalTestDefinition & {public_id: string} => ({
  type: 'api',
  subtype: 'http',
  config: {
    assertions: [],
    request: {
      headers: {},
      method: 'GET',
      timeout: 60000,
      url: 'http://fake.url',
    },
    variables: [],
  },
  locations: [],
  name: 'Test name',
  options: {
    device_ids: [],
  },
  public_id: publicId,
  ...opts,
})

export const getApiTest = (publicId = 'abc-def-ghi', opts: Partial<LocalTestDefinition> = {}): ServerTest => ({
  ...getApiLocalTestDefinition(publicId, opts),
  message: '',
  monitor_id: 0,
  status: 'live',
  tags: [],
})

export const getBrowserLocalTestDefinition = (
  publicId = 'abc-def-ghi',
  deviceIds = ['chrome.laptop_large'],
  opts: Partial<LocalTestDefinition> = {}
): LocalTestDefinition & {public_id: string} => ({
  ...getApiLocalTestDefinition(publicId, opts),
  options: {device_ids: deviceIds},
  type: 'browser',
  subtype: undefined,
})

export const getBrowserTest = (
  publicId = 'abc-def-ghi',
  deviceIds = ['chrome.laptop_large'],
  opts: Partial<LocalTestDefinition> = {}
): ServerTest => ({
  ...getBrowserLocalTestDefinition(publicId, deviceIds, opts),
  message: '',
  monitor_id: 0,
  status: 'live',
  tags: [],
})

export const getStep = (): Step => ({
  allow_failure: false,
  browser_errors: [],
  description: 'description',
  duration: 1000,
  id: -1,
  type: 'type',
  status: 'passed',
  url: 'about:blank',
  value: 'value',
  vitals_metrics: [
    {
      cls: 1,
      lcp: 1,
      url: 'http://fake.url',
    },
  ],
  warnings: [],
})

export const getMultiStep = (): MultiStep => ({
  allow_failure: false,
  assertion_results: [],
  name: 'name',
  status: 'passed',
  subtype: 'subtype',
  timings: {
    total: 123,
  },
})

export const getTestSuite = (): Suite => ({content: {tests: [{testOverrides: {}, id: '123-456-789'}]}, name: 'Suite 1'})

export const getMetadata = (): Metadata => ({
  ci: {job: {url: 'job-url'}, pipeline: {url: ''}, provider: {}, stage: {}},
  git: {commit: {author: {}, committer: {}, message: ''}},
})

export const BATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const getSummary = (): Summary => ({
  ...createInitialSummary(),
  batchId: BATCH_ID,
})

const getBaseResult = (resultId: string, test: ServerTest): Omit<BaseResult, 'result'> => ({
  duration: 1000,
  executionRule: ExecutionRule.BLOCKING,
  location: 'Frankfurt (AWS)',
  passed: true,
  resultId,
  retries: 0,
  maxRetries: 0,
  test,
  timedOut: false,
  timestamp: 1,
})

export const getBrowserResult = (
  resultId: string,
  test: ServerTest,
  resultOpts: Partial<BrowserServerResult> = {}
): BaseResult & {result: ServerResult} => ({
  ...getBaseResult(resultId, test),
  result: getBrowserServerResult(resultOpts),
  device: {
    id: 'chrome.laptop_large',
    resolution: {
      height: 1100,
      width: 1440,
    },
  },
})

export const getApiResult = (
  resultId: string,
  test: ServerTest,
  resultOpts: Partial<ApiServerResult> = {}
): BaseResult & {result: ServerResult} => ({
  ...getBaseResult(resultId, test),
  result: getApiServerResult(resultOpts),
})

export const getIncompleteServerResult = (): ServerResult => {
  return {id: 'my_result_id'} as ServerResult
}

export const getBrowserServerResult = (opts: Partial<BrowserServerResult> = {}): BrowserServerResult => ({
  id: 'my_result_id',
  finished_at: 1,
  duration: 1000,
  status: 'passed',
  start_url: '',
  steps: [],
  ...opts,
})

export const getTimedOutBrowserResult = (): Result => ({
  duration: 0,
  executionRule: ExecutionRule.BLOCKING,
  location: 'Location name',
  passed: false,
  result: {
    id: 'ghjsdghc',
    duration: 0,
    finished_at: 1,
    failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
    status: 'failed',
    steps: [],
  },
  resultId: '1',
  retries: 0,
  maxRetries: 0,
  test: getBrowserTest(),
  timedOut: true,
  timestamp: 1,
})

export const getFailedBrowserResult = (): Result => ({
  duration: 22000,
  executionRule: ExecutionRule.BLOCKING,
  location: 'Location name',
  passed: false,
  result: {
    id: 'my_result_id',
    finished_at: 1,
    duration: 22000,
    failure: {code: 'STEP_TIMEOUT', message: 'Step failed because it took more than 20 seconds.'},
    status: 'failed',
    start_url: 'https://example.org/',
    steps: [
      {
        ...getStep(),
        browser_errors: [{description: 'Error', name: 'Console error', type: 'js'}],
        description: 'Navigate to start URL',
        duration: 1000,
        status: 'passed',
        id: -1,
        type: 'goToUrlAndMeasureTti',
        url: 'https://example.org/',
        value: 'https://example.org/',
        vitals_metrics: [{url: 'https://example.com', lcp: 100, cls: 0}],
      },
      {
        ...getStep(),
        allow_failure: true,
        description: 'Navigate again',
        duration: 1000,
        failure: {message: 'Navigation failure'},
        status: 'skipped',
        id: 2,
        type: 'goToUrl',
        url: 'https://example.org/',
        value: 'https://example.org/',
        vitals_metrics: [],
      },
      {
        ...getStep(),
        description: 'Assert',
        duration: 20000,
        failure: {message: 'Step timeout'},
        public_id: 'abc-def-hij',
        id: 3,
        type: 'assertElementContent',
        url: 'https://example.org/',
        vitals_metrics: [],
      },
      {...getStep(), status: 'skipped'},
      {...getStep(), status: 'skipped'},
      {...getStep(), status: 'skipped'},
    ],
  },
  device: {
    id: 'chrome.laptop_large',
    resolution: {
      height: 1100,
      width: 1440,
    },
  },
  resultId: '1',
  retries: 0,
  maxRetries: 0,
  test: getBrowserTest(),
  timedOut: false,
  timestamp: 1,
})

export const getApiServerResult = (opts: Partial<ApiServerResult> = {}): ApiServerResult => ({
  id: 'my_api_result_id',
  finished_at: 1,
  assertions: [
    {
      actual: 'actual',
      valid: true,
    },
  ],
  status: 'passed',
  timings: {
    total: 1000,
  },
  ...opts,
})

export const getMultiStepsServerResult = (): MultiStepsServerResult => ({
  id: 'my_multi_steps_result_id',
  duration: 1000,
  finished_at: 1,
  status: 'passed',
  steps: [],
})

export const getFailedMultiStepsTestLevelServerResult = (): MultiStepsServerResult => ({
  id: 'my_multi_steps_result_id',
  finished_at: 1,
  duration: 2000,
  failure: {code: 'TEST_TIMEOUT', message: 'Error: Maximum test execution time reached: 2 seconds.'},
  status: 'failed',
  steps: [
    {
      ...getMultiStep(),
      status: 'passed',
    },
    {
      ...getMultiStep(),
      status: 'skipped',
    },
  ],
})

export const getFailedMultiStepsServerResult = (): MultiStepsServerResult => ({
  id: 'my_multi_steps_result_id',
  finished_at: 1,
  duration: 123,
  failure: {code: 'INCORRECT_ASSERTION', message: 'incorrect assertion'},
  status: 'failed',
  steps: [
    {
      ...getMultiStep(),
      status: 'passed',
    },
    {
      ...getMultiStep(),
      status: 'skipped',
    },
    {
      ...getMultiStep(),
      allow_failure: true,
      failure: {
        code: 'INCORRECT_ASSERTION',
        message: 'incorrect assertion',
      },
      status: 'failed',
    },
    {
      ...getMultiStep(),
      allow_failure: false,
      failure: {
        code: 'INCORRECT_ASSERTION',
        message: 'incorrect assertion',
      },
      status: 'failed',
    },
  ],
})

export const mockLocation: Location = {
  display_name: 'Frankfurt (AWS)',
  id: 1,
  is_active: true,
  name: 'aws:eu-central-1',
  region: 'EMEA',
}

export const mockSearchResponse = {tests: [{public_id: '123-456-789'}]}

export const mockServerTriggerResponse: ServerTrigger = {
  batch_id: 'bid',
  locations: [mockLocation],
}

export const mockTriggerInfo: TriggerInfo = {
  batchId: 'bid',
  locations: [mockLocation],
  selectiveRerunRateLimited: undefined,
  testsNotAuthorized: new Set(),
}

const mockTunnelConnectionFirstMessage = {host: 'host', id: 'tunnel-id'}

export const getSyntheticsProxy = () => {
  const calls = {
    get: jest.fn(),
    poll: jest.fn(),
    presignedUrl: jest.fn(),
    search: jest.fn(),
    trigger: jest.fn(),
    tunnel: jest.fn(),
  }

  const wss = new WebSocketServer({noServer: true})

  // eslint-disable-next-line prefer-const
  let port: number
  const proxyServer = http.createServer({}, (request, response) => {
    const mockResponse = (call: jest.Mock, responseData: any) => {
      let body = ''
      request.on('data', (data) => (body += data.toString()))
      request.on('end', () => {
        try {
          call(JSON.parse(body))
        } catch (_) {
          call(body)
        }
      })

      return response.end(JSON.stringify(responseData))
    }

    if (!request.url) {
      return response.end()
    }

    if (/\/synthetics\/tests\/search/.test(request.url)) {
      return mockResponse(calls.search, mockSearchResponse)
    }
    if (/\/synthetics\/tests\/trigger\/ci/.test(request.url)) {
      return mockResponse(calls.trigger, mockServerTriggerResponse)
    }
    if (/\/synthetics\/ci\/tunnel/.test(request.url)) {
      return mockResponse(calls.presignedUrl, {url: `ws://127.0.0.1:${port}`})
    }
    if (/\/synthetics\/tests\/poll_results/.test(request.url)) {
      return mockResponse(calls.poll, getApiResult('1', getApiTest()))
    }
    if (/\/synthetics\/tests\//.test(request.url)) {
      return mockResponse(calls.get, getApiTest('123-456-789'))
    }

    response.end()
  })

  proxyServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket as net.Socket, head, (ws: WebSocket) => {
      calls.tunnel()
      ws.send(JSON.stringify(mockTunnelConnectionFirstMessage))
    })
  })

  proxyServer.listen()
  const address = proxyServer.address()
  if (!address) {
    throw new Error('Cannot get proxy server address')
  }

  port = typeof address === 'string' ? Number(new URL(address).port) : address.port
  const config: ProxyConfiguration = {host: '127.0.0.1', port, protocol: 'http'}

  const close = () => Promise.all([new Promise((res) => proxyServer.close(res)), new Promise((res) => wss.close(res))])

  return {calls, close, config, server: proxyServer}
}

export interface RenderResultsTestCase {
  description: string
  expected: {
    exitCode: 0 | 1
    summary: Summary
  }
  failOnCriticalErrors: boolean
  failOnTimeout: boolean
  results: Result[]
  summary: Summary
}

interface ResultFixtures {
  executionRule?: ExecutionRule
  passed?: boolean
  selectiveRerun?: SelectiveRerunDecision
  testExecutionRule?: ExecutionRule
  timedOut?: boolean
  unhealthy?: boolean
}

export const getResults = (resultsFixtures: ResultFixtures[]): Result[] => {
  const results: Result[] = []

  for (const [index, resultFixtures] of resultsFixtures.entries()) {
    const {executionRule, passed, selectiveRerun, testExecutionRule, timedOut, unhealthy} = resultFixtures
    const test = getApiTest()
    if (testExecutionRule) {
      test.options.ci = {executionRule: testExecutionRule}
    }

    const result = getApiResult(index.toString(), test)
    result.executionRule = testExecutionRule || executionRule || ExecutionRule.BLOCKING
    result.passed = !!passed
    result.result = {...result.result, status: !!passed ? 'passed' : 'failed', unhealthy}

    if (timedOut) {
      result.timedOut = true
      result.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'}
    }

    if (selectiveRerun) {
      result.selectiveRerun = selectiveRerun
    }

    results.push(result)
  }

  return results
}

export const getInProgressResultInBatch = (): BaseResultInBatch => {
  return {
    duration: 0,
    execution_rule: ExecutionRule.BLOCKING,
    location: mockLocation.name,
    result_id: 'rid',
    // eslint-disable-next-line no-null/no-null
    retries: null,
    // eslint-disable-next-line no-null/no-null
    max_retries: null,
    status: 'in_progress',
    test_public_id: 'pid',
    // eslint-disable-next-line no-null/no-null
    timed_out: null,
  }
}

export const getSkippedResultInBatch = (): ResultInBatchSkippedBySelectiveRerun => {
  return {
    test_public_id: 'pid',
    execution_rule: ExecutionRule.SKIPPED,
    // eslint-disable-next-line no-null/no-null
    retries: null,
    // eslint-disable-next-line no-null/no-null
    max_retries: null,
    status: 'skipped',
    selective_rerun: {
      decision: 'skip',
      reason: 'passed',
      linked_result_id: '123',
    },
    // eslint-disable-next-line no-null/no-null
    timed_out: null,
  }
}

export const getPassedResultInBatch = (): BaseResultInBatch => {
  return {
    ...getInProgressResultInBatch(),
    duration: 1000,
    retries: 0,
    status: 'passed',
    timed_out: false,
  }
}

export const getFailedResultInBatch = (): BaseResultInBatch => {
  return {
    ...getInProgressResultInBatch(),
    duration: 1000,
    retries: 0,
    status: 'failed',
    timed_out: false,
  }
}

export const getBatch = (): Batch => ({
  results: [getPassedResultInBatch()],
  status: 'passed',
})

export const getMobileTest = (
  publicId = 'abc-def-ghi',
  appId = 'mobileAppUuid'
): MobileTestWithOverride['test'] & {public_id: string} => ({
  config: {
    assertions: [],
    request: {
      headers: {},
      method: '',
      timeout: 60000,
      url: '',
    },
    variables: [],
  },
  locations: [],
  message: '',
  monitor_id: 0,
  name: 'Mobile Test',
  options: {
    device_ids: [],
    mobileApplication: {
      applicationId: appId,
      referenceId: 'versionId',
      referenceType: 'version',
    },
  },
  public_id: publicId,
  status: 'live',
  tags: [],
  type: 'mobile',
})

export const getMockApiConfiguration = (): APIConfiguration => ({
  apiKey: '123',
  appKey: '123',
  baseIntakeUrl: 'http://baseIntake',
  baseUnstableUrl: 'http://baseUnstable',
  baseV1Url: 'http://baseV1',
  baseV2Url: 'http://baseV2',
  proxyOpts: {protocol: 'http'} as ProxyConfiguration,
})

export const getApiHelper = () => {
  return apiConstructor(getMockApiConfiguration())
}

export const mockApi = (override?: Partial<APIHelper>): APIHelper => {
  return {
    getBatch: jest.fn(),
    getMobileApplicationPresignedURLs: jest.fn(),
    getTest: jest.fn(),
    getTestVersion: jest.fn(),
    getLocalTestDefinition: jest.fn(),
    editTest: jest.fn(),
    getSyntheticsOrgSettings: jest.fn(),
    getTunnelPresignedURL: jest.fn(),
    pollResults: jest.fn(),
    searchTests: jest.fn(),
    triggerTests: jest.fn(),
    uploadMobileApplicationPart: jest.fn(),
    completeMultipartMobileApplicationUpload: jest.fn(),
    pollMobileApplicationUploadResponse: jest.fn(),
    ...override,
  }
}

export const getTestPayload = (override?: Partial<TestPayload>): TestPayload => ({
  executionRule: ExecutionRule.BLOCKING,
  public_id: 'aaa-aaa-aaa',
  ...override,
})

export const getMobileTestWithOverride = (appId: string): MobileTestWithOverride => {
  return {
    test: getMobileTest('abc-def-ghi', appId),
    overriddenConfig: getTestPayload(),
  }
}

export const getMobileTriggerConfig = (appPath?: string, appVersion?: string): TriggerConfig => {
  const testOverrides = appPath ? {mobileApplicationVersionFilePath: appPath} : {mobileApplicationVersion: appVersion}

  return {id: 'abc', testOverrides}
}

export const uploadCommandConfig: UploadApplicationCommandConfig = {
  apiKey: 'foo',
  appKey: 'bar',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  proxy: {protocol: 'http'},
  mobileApplicationVersionFilePath: 'test.apk',
  mobileApplicationId: 'abc-123-def',
  versionName: 'new version',
  latest: true,
}

export const MOBILE_PRESIGNED_URLS_PAYLOAD: MultipartPresignedUrlsResponse = {
  file_name: 'fileNameUuid',
  multipart_presigned_urls_params: {
    urls: {
      1: 'https://www.1.presigned.url',
      2: 'https://www.2.presigned.url',
    },
    key: 'fakeKey',
    upload_id: 'fakeUploadId',
  },
}

export const MOBILE_PRESIGNED_UPLOAD_PARTS: MobileApplicationUploadPart[] = [
  {partNumber: 1, md5: 'md5', blob: Buffer.from('content1')},
  {partNumber: 2, md5: 'md5', blob: Buffer.from('content2')},
]

export const APP_UPLOAD_POLL_RESULTS: MobileAppUploadResult = {
  status: 'complete',
  is_valid: true,
  valid_app_result: {
    app_version_uuid: 'appVersionUuid',
    extracted_metadata: {
      metadataKey: 'metadataValue',
    },
  },
}

export const APP_UPLOAD_SIZE_AND_PARTS = {
  appSize: 1000,
  parts: MOBILE_PRESIGNED_UPLOAD_PARTS,
}

export const APP_UPLOAD_PART_RESPONSES: MobileApplicationUploadPartResponse[] = MOBILE_PRESIGNED_UPLOAD_PARTS.map(
  (partNumber) => ({
    PartNumber: Number(partNumber),
    ETag: 'etag',
  })
)

export const getMockAppUploadReporter = (): AppUploadReporter => {
  const reporter: AppUploadReporter = new AppUploadReporter({} as any)
  reporter.start = jest.fn()
  reporter.renderProgress = jest.fn()
  reporter.reportSuccess = jest.fn()
  reporter.reportFailure = jest.fn()

  return reporter
}
