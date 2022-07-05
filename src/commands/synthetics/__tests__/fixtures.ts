import * as http from 'http'
import {URL} from 'url'

import WebSocket, {Server as WebSocketServer} from 'ws'

import {ProxyConfiguration} from '../../../helpers/utils'

import {
  ApiServerResult,
  Batch,
  BrowserServerResult,
  CommandConfig,
  ExecutionRule,
  Location,
  MainReporter,
  MultiStep,
  MultiStepsServerResult,
  Result,
  Step,
  Suite,
  Summary,
  Test,
  Trigger,
  User,
} from '../interfaces'

const mockUser: User = {
  email: '',
  handle: '',
  id: 42,
  name: '',
}

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

export const ciConfig: CommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  locations: [],
  pollingTimeout: 2 * 60 * 1000,
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
  tunnel: false,
  variableStrings: [],
}

export const getApiTest = (publicId = 'abc-def-ghi'): Test => ({
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

const getBaseResult = (resultId: string, test: Test): Omit<Result, 'result'> => ({
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
): Result => ({
  ...getBaseResult(resultId, test),
  result: getBrowserServerResult(resultOpts),
})

export const getApiResult = (resultId: string, test: Test, resultOpts: Partial<ApiServerResult> = {}): Result => ({
  ...getBaseResult(resultId, test),
  result: getApiServerResult(resultOpts),
})

export const getBrowserServerResult = (opts: Partial<BrowserServerResult> = {}): BrowserServerResult => ({
  device: {
    height: 1,
    id: 'laptop_large',
    width: 1,
  },
  duration: 0,
  passed: true,
  startUrl: '',
  stepDetails: [],
  ...opts,
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

  let port: number
  const server = http.createServer({}, (request, response) => {
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

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      calls.tunnel()
      ws.send(JSON.stringify(mockTunnelConnectionFirstMessage))
    })
  })

  server.listen()
  const address = server.address()
  port = typeof address === 'string' ? Number(new URL(address).port) : address.port
  const config: ProxyConfiguration = {host: '127.0.0.1', port, protocol: 'http'}

  const close = () => Promise.all([new Promise((res) => server.close(res)), new Promise((res) => wss.close(res))])

  return {calls, close, config, server}
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
  testExecutionRule?: ExecutionRule
  timedOut?: boolean
  unhealthy?: boolean
}

export const getResults = (resultsFixtures: ResultFixtures[]): Result[] => {
  const results: Result[] = []

  for (const [index, resultFixtures] of resultsFixtures.entries()) {
    const {executionRule, passed, testExecutionRule, timedOut, unhealthy} = resultFixtures
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
      result.result.failure = {code: 'TIMEOUT', message: 'Result timed out'}
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
