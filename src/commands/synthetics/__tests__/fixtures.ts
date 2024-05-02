import * as http from 'http'
import * as net from 'net'
import {URL} from 'url'

import type {AxiosResponse, InternalAxiosRequestConfig} from 'axios'

import {AxiosError} from 'axios'
import WebSocket, {Server as WebSocketServer} from 'ws'

import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {
  ApiServerResult,
  BaseResult,
  Batch,
  BrowserServerResult,
  ExecutionRule,
  Location,
  MainReporter,
  MobileApplicationVersion,
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
  Test,
  TestPayload,
  Trigger,
  UploadApplicationCommandConfig,
  User,
} from '../interfaces'
import {createInitialSummary} from '../utils/public'

const mockUser: User = {
  email: '',
  handle: '',
  id: 42,
  name: '',
}

export const MOCK_BASE_URL = 'https://app.datadoghq.com/'

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
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  defaultTestOverrides: {},
  locations: [],
  pollingTimeout: 2 * 60 * 1000,
  proxy: {protocol: 'http'},
  publicIds: [],
  selectiveRerun: false,
  subdomain: 'app',
  tunnel: false,
  variableStrings: [],
}

export const getAxiosHttpError = (status: number, {errors, message}: {errors?: string[]; message?: string}) => {
  const serverError = new AxiosError(message) as AxiosError<any> & {config: InternalAxiosRequestConfig}
  serverError.config = {baseURL: MOCK_BASE_URL, url: 'example'} as InternalAxiosRequestConfig
  serverError.response = {data: {errors}, status} as AxiosResponse

  return serverError
}

export const getApiTest = (publicId = 'abc-def-ghi', opts: Partial<Test> = {}): Test => ({
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
  created_at: '',
  created_by: mockUser,
  locations: [],
  message: '',
  modified_at: '',
  modified_by: mockUser,
  monitor_id: 0,
  name: 'Test name',
  options: {
    device_ids: [],
    min_failure_duration: 0,
    min_location_failed: 0,
    tick_every: 3600,
  },
  overall_state: 0,
  overall_state_modified: '',
  public_id: publicId,
  status: '',
  stepCount: 0,
  subtype: 'http',
  tags: [],
  type: 'api',
  ...opts,
})

export const getBrowserTest = (
  publicId = 'abc-def-ghi',
  deviceIds = ['chrome.laptop_large'],
  opts: Partial<Test> = {}
): Test => ({
  ...getApiTest(publicId),
  options: {device_ids: deviceIds, min_failure_duration: 0, min_location_failed: 1, tick_every: 300},
  type: 'browser',
  ...opts,
})

export const getStep = (): Step => ({
  allowFailure: false,
  browserErrors: [],
  description: 'description',
  duration: 1000,
  skipped: false,
  stepId: -1,
  type: 'type',
  url: 'about:blank',
  value: 'value',
  vitalsMetrics: [
    {
      cls: 1,
      lcp: 1,
      url: 'http://fake.url',
    },
  ],
  warnings: [],
})

export const getMultiStep = (): MultiStep => ({
  allowFailure: false,
  assertionResults: [],
  name: 'name',
  passed: true,
  skipped: false,
  subtype: 'subtype',
  timings: {
    total: 123,
  },
})

export const getTestSuite = (): Suite => ({content: {tests: [{config: {}, id: '123-456-789'}]}, name: 'Suite 1'})

export const BATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const getSummary = (): Summary => ({
  ...createInitialSummary(),
  batchId: BATCH_ID,
})

const getBaseResult = (resultId: string, test: Test): Omit<BaseResult, 'result'> => ({
  executionRule: ExecutionRule.BLOCKING,
  location: 'Frankfurt (AWS)',
  passed: true,
  resultId,
  test,
  timedOut: false,
  timestamp: 1,
})

export const getBrowserResult = (
  resultId: string,
  test: Test,
  resultOpts: Partial<BrowserServerResult> = {}
): BaseResult => ({
  ...getBaseResult(resultId, test),
  result: getBrowserServerResult(resultOpts),
})

export const getApiResult = (resultId: string, test: Test, resultOpts: Partial<ApiServerResult> = {}): BaseResult => ({
  ...getBaseResult(resultId, test),
  result: getApiServerResult(resultOpts),
})

export const getBrowserServerResult = (opts: Partial<BrowserServerResult> = {}): BrowserServerResult => ({
  device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
  duration: 0,
  passed: true,
  startUrl: '',
  stepDetails: [],
  ...opts,
})

export const getTimedOutBrowserResult = (): Result => ({
  executionRule: ExecutionRule.BLOCKING,
  location: 'Location name',
  passed: false,
  result: {
    duration: 0,
    failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
    passed: false,
    steps: [],
  },
  resultId: '1',
  test: getBrowserTest(),
  timedOut: true,
  timestamp: 1,
})

export const getFailedBrowserResult = (): Result => ({
  executionRule: ExecutionRule.BLOCKING,
  location: 'Location name',
  passed: false,
  result: {
    device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
    duration: 20000,
    failure: {code: 'STEP_TIMEOUT', message: 'Step failed because it took more than 20 seconds.'},
    passed: false,
    startUrl: 'https://example.org/',
    stepDetails: [
      {
        ...getStep(),
        browserErrors: [{description: 'Error', name: 'Console error', type: 'js'}],
        description: 'Navigate to start URL',
        duration: 1000,
        skipped: false,
        stepId: -1,
        type: 'goToUrlAndMeasureTti',
        url: 'https://example.org/',
        value: 'https://example.org/',
        vitalsMetrics: [{url: 'https://example.com', lcp: 100, cls: 0}],
      },
      {
        ...getStep(),
        allowFailure: true,
        description: 'Navigate',
        duration: 1000,
        error: 'Navigation failure',
        skipped: true,
        stepId: 2,
        type: 'goToUrl',
        url: 'https://example.org/',
        value: 'https://example.org/',
        vitalsMetrics: [],
      },
      {
        ...getStep(),
        description: 'Assert',
        duration: 1000,
        error: 'Step failure',
        publicId: 'abc-def-hij',
        skipped: true,
        stepId: 3,
        type: 'assertElementContent',
        url: 'https://example.org/',
        vitalsMetrics: [],
      },
      {...getStep(), skipped: true},
      {...getStep(), skipped: true},
      {...getStep(), skipped: true},
    ],
  },
  resultId: '1',
  test: getBrowserTest(),
  timedOut: false,
  timestamp: 1,
})

export const getApiServerResult = (opts: Partial<ApiServerResult> = {}): ApiServerResult => ({
  assertionResults: [
    {
      actual: 'actual',
      valid: true,
    },
  ],
  passed: true,
  timings: {
    total: 123,
  },
  ...opts,
})

export const getMultiStepsServerResult = (): MultiStepsServerResult => ({
  duration: 123,
  passed: true,
  steps: [],
})

export const getFailedMultiStepsTestLevelServerResult = (): MultiStepsServerResult => ({
  duration: 2000,
  failure: {code: 'TEST_TIMEOUT', message: 'Error: Maximum test execution time reached: 2 seconds.'},
  passed: false,
  steps: [
    {
      ...getMultiStep(),
      passed: true,
    },
    {
      ...getMultiStep(),
      skipped: true,
    },
  ],
})

export const getFailedMultiStepsServerResult = (): MultiStepsServerResult => ({
  duration: 123,
  failure: {code: 'INCORRECT_ASSERTION', message: 'incorrect assertion'},
  passed: false,
  steps: [
    {
      ...getMultiStep(),
      passed: true,
    },
    {
      ...getMultiStep(),
      skipped: true,
    },
    {
      ...getMultiStep(),
      allowFailure: true,
      failure: {
        code: 'INCORRECT_ASSERTION',
        message: 'incorrect assertion',
      },
      passed: false,
    },
    {
      ...getMultiStep(),
      allowFailure: false,
      failure: {
        code: 'INCORRECT_ASSERTION',
        message: 'incorrect assertion',
      },
      passed: false,
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

export const mockTestTriggerResponse: Trigger = {
  batch_id: 'bid',
  locations: [mockLocation],
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
      return mockResponse(calls.trigger, mockTestTriggerResponse)
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
    result.result = {...result.result, passed: !!passed, unhealthy}

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

export const getBatch = (): Batch => ({
  results: [
    {
      execution_rule: ExecutionRule.BLOCKING,
      location: mockLocation.name,
      result_id: 'rid',
      status: 'passed',
      test_public_id: 'pid',
      timed_out: false,
    },
  ],
  status: 'passed',
})

export const getMobileTest = (publicId = 'abc-def-ghi'): Test => ({
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
  created_at: '',
  created_by: mockUser,
  locations: [],
  message: '',
  modified_at: '',
  modified_by: mockUser,
  monitor_id: 0,
  name: 'Mobile Test',
  options: {
    device_ids: [],
    min_failure_duration: 0,
    min_location_failed: 0,
    mobileApplication: {
      applicationId: 'mobileAppUuid',
      referenceId: 'versionId',
      referenceType: 'version',
    },
    tick_every: 3600,
  },
  overall_state: 0,
  overall_state_modified: '',
  public_id: publicId,
  status: '',
  stepCount: 0,
  subtype: '',
  tags: [],
  type: 'mobile',
})

export const getApiHelper = () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }

  return apiConstructor(apiConfiguration)
}

export const getTestPayload = (override?: Partial<TestPayload>) => ({
  executionRule: ExecutionRule.BLOCKING,
  public_id: 'aaa-aaa-aaa',
  ...override,
})

export const getMobileVersion = (override?: Partial<MobileApplicationVersion>) => ({
  id: '123-abc-456',
  application_id: '789-dfg-987',
  file_name: 'bla.',
  original_file_name: 'test.apk',
  is_latest: true,
  version_name: 'test version',
  created_at: '22-09-2022',
  ...override,
})

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
