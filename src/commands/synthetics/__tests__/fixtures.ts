import deepExtend from 'deep-extend'
import * as http from 'http'
import {URL} from 'url'

import WebSocket, {Server as WebSocketServer} from 'ws'

import {ProxyConfiguration} from '../../../helpers/utils'

import {
  ApiTestResult,
  BrowserTestResult,
  CommandConfig,
  ConfigOverride,
  ExecutionRule,
  Location,
  MainReporter,
  MultiStep,
  MultiStepsTestResult,
  PollResult,
  Step,
  Suite,
  Summary,
  Test,
  TestResult,
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

export const getApiTest = (publicId: string): Test => ({
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

const getPollResult = (resultId: string): Omit<PollResult, 'result'> => ({
  dc_id: 1,
  resultID: resultId,
  timestamp: 1,
})

export const getBrowserPollResult = (resultId: string, resultOpts: Partial<BrowserTestResult> = {}): PollResult => ({
  ...getPollResult(resultId),
  result: getBrowserResult(resultOpts),
})

export const getApiPollResult = (resultId: string, resultOpts: Partial<ApiTestResult> = {}): PollResult => ({
  ...getPollResult(resultId),
  result: getApiResult(resultOpts),
})

const getResult = (): TestResult => ({
  eventType: 'finished',
  passed: true,
})

export const getBrowserResult = (opts: Partial<BrowserTestResult> = {}): BrowserTestResult => ({
  ...getResult(),
  device: {
    height: 1,
    id: 'laptop_large',
    width: 1,
  },
  duration: 0,
  startUrl: '',
  stepDetails: [],
  tunnel: false,
  ...opts,
})

export const getApiResult = (opts: Partial<ApiTestResult> = {}): ApiTestResult => ({
  ...getResult(),
  assertionResults: [
    {
      actual: 'actual',
      valid: true,
    },
  ],
  timings: {
    total: 123,
  },
  ...opts,
})

export const getMultiStepsResult = (): MultiStepsTestResult => ({
  ...getResult(),
  duration: 123,
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
  triggered_check_ids: ['123-456-789'],
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
      return mockResponse(calls.poll, getApiPollResult('1'))
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
    testsOrderList: string[]
  }
  failOnCriticalErrors: boolean
  failOnTimeout: boolean
  fixtures: {
    results: Record<string, PollResult[]>
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
  polledResultsByPublicId: Record<string, PollResult[]>
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
    const mergedPolledResults = testFixtures
      .map(({polledResultsByPublicId}) => polledResultsByPublicId)
      .reduce((mergedResults, polledResultsByPublicId) => {
        for (const [testPublicId, polledResults] of Object.entries(polledResultsByPublicId)) {
          if (!mergedResults[testPublicId]) {
            mergedResults[testPublicId] = []
          }
          mergedResults[testPublicId] = mergedResults[testPublicId].concat(polledResults)
        }

        return mergedResults
      }, {})

    const triggerResults = testFixtures.map(({triggerResult}) => triggerResult)

    return {
      results: mergedPolledResults,
      tests: testFixtures.map(({test}) => test),
      triggers: {
        locations: [mockLocation],
        results: triggerResults,
        triggered_check_ids: triggerResults.map(({public_id}) => public_id),
      },
    }
  }

  private getNextTriggerResultAndPolledResults({
    configOverride,
    publicId,
    resultError,
    resultIsUnhealthy,
    resultPassed,
  }: Omit<RenderResultsTestFixtureConfigs, 'executionRule'>): [TriggerResponse, Record<string, PollResult[]>] {
    const triggerResult = getTriggerResult(publicId, this.resultIdCounter.toString())
    const polledResults = {
      [publicId]: [
        deepExtend(getApiPollResult(this.resultIdCounter.toString()), {
          enrichment: {config_override: configOverride},
          result: {passed: resultPassed, error: resultError, unhealthy: resultIsUnhealthy},
        }),
      ],
    }

    this.resultIdCounter++

    return [triggerResult, polledResults]
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

    const [triggerResult, polledResultsByPublicId] = this.getNextTriggerResultAndPolledResults({
      configOverride,
      publicId,
      resultError,
      resultIsUnhealthy,
      resultPassed,
    })

    return {test, triggerResult, polledResultsByPublicId}
  }

  private resetResultIdCounter() {
    this.resultIdCounter = 1
  }
}
