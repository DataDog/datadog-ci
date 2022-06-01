import deepExtend from 'deep-extend'
import * as http from 'http'
import {URL} from 'url'

import WebSocket, {Server as WebSocketServer} from 'ws'

import {ProxyConfiguration} from '../../../helpers/utils'

import {
  ApiServerResult,
  BrowserServerResult,
  CommandConfig,
  ConfigOverride,
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
  TriggerResponse,
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
  runEnd: jest.fn(),
  testEnd: jest.fn(),
  testResult: jest.fn(),
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
  dcId: 1,
  passed: false,
  resultId,
  test,
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
  eventType: 'finished',
  passed: true,
  startUrl: '',
  stepDetails: [],
  tunnel: false,
  ...opts,
})

export const getApiServerResult = (opts: Partial<ApiServerResult> = {}): ApiServerResult => ({
  assertionResults: [
    {
      actual: 'actual',
      valid: true,
    },
  ],
  eventType: 'finished',
  passed: true,
  timings: {
    total: 123,
  },
  ...opts,
})

export const getMultiStepsServerResult = (): MultiStepsServerResult => ({
  duration: 123,
  eventType: 'finished',
  passed: true,
  steps: [],
})

const mockTriggerResult: TriggerResponse = {
  device: 'chrome_laptop.large',
  location: 1,
  public_id: '123-456-789',
  result_id: '1',
}

export const getTriggerResult = (publicId: string, resultId: string): TriggerResponse => ({
  ...mockTriggerResult,
  public_id: publicId,
  result_id: resultId,
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
  locations: [mockLocation],
  results: [mockTriggerResult],
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
  fixtures: {
    results: Result[]
    tests: Test[]
    triggers: Trigger
  }
  summary: Summary
}

interface RenderResultsTestFixtureConfigs {
  configOverride: ConfigOverride
  executionRule?: ExecutionRule
  publicId: string
  resultError?: string
  resultIsUnhealthy?: boolean
  resultPassed: boolean
}

interface RenderResultsTestFixtures {
  results: Result[]
  test: Test
  triggerResult: TriggerResponse
}

export class RenderResultsHelper {
  private resultIdCounter = 1

  public createFixtures(testFixturesConfigs: RenderResultsTestFixtureConfigs[]): RenderResultsTestCase['fixtures'] {
    const fixtures = this.combineTestFixtures(testFixturesConfigs.map((c) => this.getTestFixtures(c)))
    this.resetResultIdCounter()

    return fixtures
  }

  private combineTestFixtures(testFixtures: RenderResultsTestFixtures[]): RenderResultsTestCase['fixtures'] {
    const mergedResults = ([] as Result[]).concat(...testFixtures.map(({results}) => results))
    const triggerResults = testFixtures.map(({triggerResult}) => triggerResult)

    return {
      results: mergedResults,
      tests: testFixtures.map(({test}) => test),
      triggers: {
        locations: [mockLocation],
        results: triggerResults,
      },
    }
  }

  private getNextTriggerResultAndResult({
    configOverride,
    publicId,
    resultError,
    resultIsUnhealthy,
    resultPassed,
    test,
  }: Omit<RenderResultsTestFixtureConfigs, 'executionRule'> & {test: Test}): [TriggerResponse, Result] {
    const triggerResult = getTriggerResult(publicId, this.resultIdCounter.toString())

    const result = deepExtend(getApiResult(this.resultIdCounter.toString(), test), {
      enrichment: {config_override: configOverride},
      result: {passed: resultPassed, error: resultError, unhealthy: resultIsUnhealthy},
    })

    this.resultIdCounter++

    return [triggerResult, result]
  }

  private getTestFixtures({
    configOverride,
    executionRule,
    publicId,
    resultError,
    resultIsUnhealthy,
    resultPassed,
  }: RenderResultsTestFixtureConfigs): RenderResultsTestFixtures {
    const test = executionRule
      ? deepExtend(getApiTest(publicId), {options: {ci: {executionRule}}})
      : getApiTest(publicId)

    const [triggerResult, result] = this.getNextTriggerResultAndResult({
      configOverride,
      publicId,
      resultError,
      resultIsUnhealthy,
      resultPassed,
      test,
    })

    return {test, triggerResult, results: [result]}
  }

  private resetResultIdCounter() {
    this.resultIdCounter = 1
  }
}
