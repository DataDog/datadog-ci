import deepExtend from 'deep-extend'

import {MOCK_BASE_URL, getAxiosError} from '../../../helpers/__tests__/fixtures'
import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {getResultsToReport, reportReceivedResults, waitForResults} from '../batch'
import {BatchTimeoutRunawayError} from '../errors'
import {BaseResult, Batch, ExecutionRule, PollResult, Result, ResultInBatch, ServerResult} from '../interfaces'
import {DEFAULT_COMMAND_CONFIG} from '../run-tests-command'
import * as internalUtils from '../utils/internal'

import {
  getApiTest,
  getBatch,
  getBrowserServerResult,
  getFailedResultInBatch,
  getInProgressResultInBatch,
  getIncompleteServerResult,
  getPassedResultInBatch,
  getSkippedResultInBatch,
  mockLocation,
  mockReporter,
} from './fixtures'

describe('waitForResults', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  beforeEach(() => {
    jest.useFakeTimers({now: 123})
    jest.spyOn(internalUtils, 'wait').mockImplementation(async () => jest.advanceTimersByTime(5000))
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const batch: Batch = getBatch()
  const apiTest = getApiTest('pid')
  const result: BaseResult & {result: ServerResult} = {
    duration: 1000,
    executionRule: ExecutionRule.BLOCKING,
    initialResultId: undefined,
    isNonFinal: false,
    location: mockLocation.display_name,
    passed: true,
    result: getBrowserServerResult({passed: true}),
    resultId: 'rid',
    retries: 0,
    maxRetries: 0,
    selectiveRerun: undefined,
    test: apiTest,
    timedOut: false,
    timestamp: 0,
  }
  const pollResult: PollResult & {result: ServerResult} = {
    check: result.test,
    result: result.result,
    resultID: result.resultId,
    timestamp: result.timestamp,
  }
  const trigger = {batch_id: 'bid', locations: [mockLocation]}

  const mockApi = ({
    getBatchImplementation,
    pollResultsImplementation,
  }: {
    getBatchImplementation?(): Promise<Batch>
    pollResultsImplementation?(): Promise<PollResult[]>
  } = {}) => {
    const getBatchMock = jest
      .spyOn(api, 'getBatch')
      .mockImplementation(getBatchImplementation || (async () => deepExtend({}, batch)))

    const pollResultsMock = jest
      .spyOn(api, 'pollResults')
      .mockImplementation(pollResultsImplementation || (async () => [deepExtend({}, pollResult)]))

    return {getBatchMock, pollResultsMock}
  }

  const waiter: {
    promise: Promise<unknown>
    start: () => void
    resolve: (value?: unknown) => void
  } = {
    promise: Promise.resolve(),
    resolve: () => {},
    start() {
      this.promise = new Promise((resolve) => (this.resolve = resolve))
    },
  }

  test('should poll result ids', async () => {
    mockApi()

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toEqual([result])
  })

  test('should show results as they arrive', async () => {
    jest.spyOn(internalUtils, 'wait').mockImplementation(async () => waiter.resolve())

    const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

    // === STEP 1 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getInProgressResultInBatch()},
          {...getInProgressResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [deepExtend({}, pollResult)],
    })

    const resultsPromise = waitForResults(
      api,
      trigger,
      tests,
      {
        batchTimeout: 120000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: false,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter
    )

    // Wait for the 2 tests (initial)
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

    await waiter.promise

    // No results received
    expect(mockReporter.resultReceived).not.toHaveBeenCalled()
    expect(mockReporter.resultEnd).not.toHaveBeenCalled()
    // Still waiting for the 2 tests
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(2, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 2 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getInProgressResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult),
        deepExtend({}, pollResult, {resultID: 'rid-2'}),
        deepExtend({}, pollResult, {resultID: 'rid-3'}),
      ],
    })

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
      ...batch.results[0],
      status: 'passed',
      result_id: 'rid-2',
    })
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
    // Still waiting for 2 tests
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(3, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 3 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getPassedResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult),
        deepExtend({}, pollResult, {resultID: 'rid-2'}),
        deepExtend({}, pollResult, {resultID: 'rid-3'}),
      ],
    })

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
      ...batch.results[0],
      status: 'passed',
    })
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, result, MOCK_BASE_URL, 'bid')
    // Now waiting for 1 test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(4, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 4 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getPassedResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {
            ...getInProgressResultInBatch(), // stays in progress
            duration: 1000,
            retries: 0, // `retries` is set => first attempt failed, but will be fast retried
            test_public_id: 'other-public-id',
            timed_out: false,
            result_id: 'rid-3',
          },
        ],
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult),
        deepExtend({}, pollResult, {resultID: 'rid-2'}),
        deepExtend({}, pollResult, {resultID: 'rid-3'}),
      ],
    })

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(3, {
      ...batch.results[0],
      duration: 1000,
      status: 'in_progress',
      test_public_id: 'other-public-id',
      result_id: 'rid-3',
    })
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
      3,
      {...result, isNonFinal: true, resultId: 'rid-3', passed: false}, // the first attempt failed, so it's being retried
      MOCK_BASE_URL,
      'bid'
    )
    // Now waiting for 1 test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(5, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 5 === (batch 'passed')
    mockApi({
      getBatchImplementation: async () => ({
        status: 'passed',
        results: [
          // First test
          {...getPassedResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getPassedResultInBatch(), retries: 1, test_public_id: 'other-public-id', result_id: 'rid-3-final'},
        ],
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult),
        deepExtend({}, pollResult, {resultID: 'rid-2'}),
        deepExtend({}, pollResult, {resultID: 'rid-3-final'}),
      ],
    })

    expect(await resultsPromise).toEqual([
      result,
      {...result, resultId: 'rid-2'},
      {...result, resultId: 'rid-3-final', retries: 1},
    ])

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(4, {
      ...batch.results[0],
      status: 'passed',
      test_public_id: 'other-public-id',
      result_id: 'rid-3-final',
      retries: 1,
    })
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
      4,
      {...result, resultId: 'rid-3-final', retries: 1},
      MOCK_BASE_URL,
      'bid'
    )
    // Do not report when there are no tests to wait anymore
    expect(mockReporter.testsWait).toHaveBeenCalledTimes(5)
  })

  test('skipped results are reported as received', async () => {
    jest.spyOn(internalUtils, 'wait').mockImplementation(async () => waiter.resolve())

    const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

    // === STEP 1 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getSkippedResultInBatch()}, // skipped by selective rerun
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => [{...pollResult, resultID: 'rid-2'}],
    })

    const resultsPromise = waitForResults(
      api,
      trigger,
      tests,
      {
        batchTimeout: 120000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: false,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter
    )

    // Wait for the 2 tests (initial)
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

    await waiter.promise

    // The skipped result is received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
      ...getSkippedResultInBatch(),
    })
    // And marked as passed because it's selective rerun
    const skippedResult: Result = {
      executionRule: ExecutionRule.SKIPPED,
      passed: true,
      resultId: '123',
      selectiveRerun: {decision: 'skip', reason: 'passed', linked_result_id: '123'},
      test: result.test,
      timedOut: false,
    }
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, skippedResult, MOCK_BASE_URL, 'bid')
    // Now waiting for the remaining test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(2, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 1)

    // === STEP 2 === (batch 'passed')
    mockApi({
      getBatchImplementation: async () => ({
        status: 'passed',
        results: [
          // First test
          {...getSkippedResultInBatch()},
          // Second test
          {...getPassedResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => [deepExtend({}, pollResult, {resultID: 'rid-2'})],
    })

    expect(await resultsPromise).toEqual([{...skippedResult}, {...result, resultId: 'rid-2'}])

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
      ...batch.results[0],
      status: 'passed',
      test_public_id: 'other-public-id',
      result_id: 'rid-2',
    })
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
    expect(mockReporter.testsWait).toHaveBeenCalledTimes(2)
  })

  test('should wait for incomplete results', async () => {
    jest.spyOn(internalUtils, 'wait').mockImplementation(async () => waiter.resolve())

    const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

    // === STEP 1 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getInProgressResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [{...pollResult, resultID: 'rid-2', result: getIncompleteServerResult()}],
    })

    const resultsPromise = waitForResults(
      api,
      trigger,
      tests,
      {
        batchTimeout: 120000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: false,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter
    )

    // Wait for the 2 tests (initial)
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
      ...batch.results[0],
      status: 'passed',
      result_id: 'rid-2',
    })
    // But the data from `/poll_results` data is not available yet, so we should wait more before reporting
    expect(mockReporter.resultEnd).not.toHaveBeenCalled()
    // Still waiting for 2 tests
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(2, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 2 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getPassedResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [
        {...pollResult, result: getIncompleteServerResult()}, // not available yet
        deepExtend({}, pollResult, {resultID: 'rid-2'}), // just became available
      ],
    })

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
      ...batch.results[0],
      status: 'passed',
    })
    // Result 2 just became available, so it should be reported
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
    // Now waiting for 1 test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(3, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 3 === (batch 'failed')
    mockApi({
      getBatchImplementation: async () => ({
        status: 'failed', // nothing to do with the fact that the result is incomplete
        results: [
          // First test
          {...getFailedResultInBatch()},
          {...getPassedResultInBatch(), result_id: 'rid-2'},
          // Second test
          {...getPassedResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
        ],
      }),
      pollResultsImplementation: async () => [
        {...pollResult, result: getIncompleteServerResult()}, // still not available
        deepExtend({}, pollResult, {resultID: 'rid-2'}),
        deepExtend({}, pollResult, {resultID: 'rid-3'}),
      ],
    })

    expect(await resultsPromise).toEqual([
      {...result, resultId: 'rid', passed: false, result: undefined},
      {...result, resultId: 'rid-2'},
      {...result, resultId: 'rid-3'},
    ])

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(3, {
      ...batch.results[0],
      status: 'passed',
      test_public_id: 'other-public-id',
      result_id: 'rid-3',
    })
    // Result 3 was available instantly
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, {...result, resultId: 'rid-3'}, MOCK_BASE_URL, 'bid')

    // Result 1 never became available (but the batch says it did not pass)
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
      3,
      {...result, passed: false, resultId: 'rid', result: undefined},
      MOCK_BASE_URL,
      'bid'
    )
    expect(mockReporter.error).toHaveBeenCalledWith(
      'The information for result rid of test pid was incomplete at the end of the batch.\n\n'
    )

    // Do not report when there are no tests to wait anymore
    expect(mockReporter.testsWait).toHaveBeenCalledTimes(3)
  })

  test('should wait for incomplete results caused by 404', async () => {
    jest.spyOn(internalUtils, 'wait').mockImplementation(async () => waiter.resolve())

    const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

    // === STEP 1 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getInProgressResultInBatch()},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => [],
    })

    const resultsPromise = waitForResults(
      api,
      trigger,
      tests,
      {
        batchTimeout: 120000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: false,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter
    )

    // Wait for the 2 tests (initial)
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

    await waiter.promise

    // Still waiting for 2 tests
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(2, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 2 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getPassedResultInBatch()},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => {
        throw getAxiosError(404, {message: 'Test results not found'})
      },
    })

    await waiter.promise

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
      ...batch.results[0],
      status: 'passed',
    })
    // But not available
    expect(mockReporter.resultEnd).not.toHaveBeenCalled()
    // Now waiting for 1 test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(3, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    // === STEP 3 === (batch 'in_progress')
    waiter.start()
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          // First test
          {...getPassedResultInBatch()},
          // Second test
          {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult), // became available
      ],
    })

    await waiter.promise

    // Result 1 just became available, so it should be reported
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, result, MOCK_BASE_URL, 'bid')
    // Still waiting for 1 test
    expect(mockReporter.testsWait).toHaveBeenNthCalledWith(3, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

    mockApi({
      getBatchImplementation: async () => ({
        status: 'passed',
        results: [
          // First test
          {...getPassedResultInBatch()},
          // Second test
          {...getPassedResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
        ],
      }),
      pollResultsImplementation: async () => {
        throw getAxiosError(404, {message: 'Test results not found'})
      },
    })

    expect(await resultsPromise).toEqual([
      result,
      {...result, resultId: 'rid-2', result: undefined, timestamp: 123, test: tests[1]},
    ])

    // One result received
    expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
      ...batch.results[0],
      status: 'passed',
      test_public_id: 'other-public-id',
      result_id: 'rid-2',
    })
    // Last result is reported without a poll result
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
      2,
      {...result, resultId: 'rid-2', result: undefined, test: tests[1], timestamp: 123},
      MOCK_BASE_URL,
      'bid'
    )
    expect(mockReporter.error).toHaveBeenCalledWith(
      'The information for result rid-2 of test other-public-id was incomplete at the end of the batch.\n\n'
    )

    // Do not report when there are no tests to wait anymore
    expect(mockReporter.testsWait).toHaveBeenCalledTimes(4)
  })

  test('object in each result should be different even if they share the same public ID (config overrides)', async () => {
    mockApi({
      getBatchImplementation: async () => ({
        results: [getPassedResultInBatch(), {...getPassedResultInBatch(), result_id: '3'}],
        status: 'passed',
      }),
      pollResultsImplementation: async () => [
        deepExtend({}, pollResult),
        // The test object from the second result has an overridden start URL
        deepExtend({}, pollResult, {check: {config: {request: {url: 'https://reddit.com/'}}}, resultID: '3'}),
      ],
    })

    const results = await waitForResults(
      api,
      trigger,
      [result.test, result.test],
      {
        batchTimeout: 0,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: false,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter
    )

    expect(results.map(({test}) => test.config.request.url)).toEqual(['http://fake.url', 'https://reddit.com/'])
  })

  test('results should be timed out if the backend says so', async () => {
    mockApi({
      getBatchImplementation: async () => ({
        status: 'failed',
        results: [{...getPassedResultInBatch()}, {...getFailedResultInBatch(), result_id: '3', timed_out: true}],
      }),
      pollResultsImplementation: async () => [
        {...pollResult, result: {...pollResult.result}},
        {...pollResult, result: {...pollResult.result}, resultID: '3'},
      ],
    })

    const expectedTimeoutResult = {
      ...result,
      result: {
        ...result.result,
        failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
        passed: false,
      },
      resultId: '3',
      timedOut: true,
    }

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test, result.test],
        {
          batchTimeout: 3000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toEqual([result, expectedTimeoutResult])

    expect(mockReporter.resultReceived).toHaveBeenCalledTimes(2)

    // `resultEnd` should return the same data as `waitForResults`
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, result, MOCK_BASE_URL, 'bid')
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, expectedTimeoutResult, MOCK_BASE_URL, 'bid')

    // Failed directly.
    expect(internalUtils.wait).toHaveBeenCalledTimes(0)
  })

  test('results should be timed out with a different error if the backend did not say so', async () => {
    mockApi({
      getBatchImplementation: async () => ({
        status: 'in_progress',
        results: [
          {...getPassedResultInBatch()},
          {...getInProgressResultInBatch(), result_id: '3'}, // `timed_out: null`
        ],
      }),
      pollResultsImplementation: async () => [
        {...pollResult, result: {...pollResult.result}},
        {...pollResult, result: {...pollResult.result}, resultID: '3'},
      ],
    })

    const expectedDeadlineResult: Result = {
      ...result,
      duration: 0,
      result: {
        ...result.result,
        failure: {
          code: 'BATCH_TIMEOUT_RUNAWAY',
          message: "The batch didn't timeout after the expected timeout period.",
        },
        passed: false,
      },
      resultId: '3',
      timedOut: true,
    }

    await expect(
      waitForResults(
        api,
        trigger,
        [result.test, result.test],
        {
          batchTimeout: 3000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).rejects.toThrow(new BatchTimeoutRunawayError())

    // Residual results are never 'received': we force-end them.
    expect(mockReporter.resultReceived).toHaveBeenCalledTimes(1)

    // `resultEnd` should return the same data as `waitForResults`
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, result, MOCK_BASE_URL, 'bid')
    expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, expectedDeadlineResult, MOCK_BASE_URL, 'bid')

    // Initial wait + 3 polling cycles.
    expect(internalUtils.wait).toHaveBeenCalledTimes(4)
  })

  test('results failure should be ignored if timed out', async () => {
    // The original failure of a result received between timing out in batch poll
    // and retrieving it should be ignored in favor of timeout.
    mockApi({
      getBatchImplementation: async () => ({
        status: 'failed',
        results: [{...getFailedResultInBatch(), timed_out: true}],
      }),
      pollResultsImplementation: async () => [
        {
          ...pollResult,
          passed: false,
          result: {
            ...pollResult.result,
            failure: {code: 'FAILURE', message: 'Original failure, should be ignored'},
            passed: false,
          },
        },
      ],
    })

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 0,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toStrictEqual([
      {
        ...result,
        result: {
          ...result.result,
          failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
          passed: false,
        },
        timedOut: true,
      },
    ])
  })

  test('results should be timed out if batch result is timed out', async () => {
    const batchWithTimeoutResult: Batch = {
      ...batch,
      results: [{...getFailedResultInBatch(), timed_out: true}],
    }

    mockApi({getBatchImplementation: async () => batchWithTimeoutResult})

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toEqual([
      {
        ...result,
        result: {
          ...result.result,
          failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
          passed: false,
        },
        timedOut: true,
      },
    ])
  })

  test('wait between batch polling', async () => {
    const {getBatchMock} = mockApi({
      getBatchImplementation: async () => {
        return getBatchMock.mock.calls.length === 3 ? batch : {...batch, status: 'in_progress'}
      },
    })

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toEqual([result])

    expect(getBatchMock).toHaveBeenCalledTimes(3)
    expect(internalUtils.wait).toHaveBeenCalledTimes(2)
  })

  test('correct number of passed and timed out results', async () => {
    const pollTimeoutResult: PollResult = {...deepExtend({}, pollResult), resultID: 'another-id'}
    const batchWithTimeoutResult: Batch = {
      ...batch,
      results: [
        {...getPassedResultInBatch()},
        {...getFailedResultInBatch(), timed_out: true, result_id: pollTimeoutResult.resultID},
      ],
    }

    mockApi({
      getBatchImplementation: async () => batchWithTimeoutResult,
      pollResultsImplementation: async () => [pollResult, pollTimeoutResult],
    })

    expect(
      await waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).toEqual([
      {
        ...result,
        passed: true,
        timedOut: false,
      },
      {
        ...result,
        passed: true, // because `failOnTimeout` is false
        timedOut: true,
        resultId: pollTimeoutResult.resultID,
        result: {
          ...result.result,
          failure: {
            code: 'TIMEOUT',
            message: 'The batch timed out before receiving the result.',
          },
          passed: false,
        },
      },
    ])

    expect(mockReporter.resultReceived).toHaveBeenCalledTimes(2)
    expect(mockReporter.resultEnd).toHaveBeenCalledTimes(2)
  })

  test('tunnel failure', async () => {
    mockApi()

    const mockTunnel = {
      keepAlive: async () => {
        throw new Error('keepAlive failed')
      },
    } as any

    await waitForResults(
      api,
      trigger,
      [result.test],
      {
        batchTimeout: 2000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: true,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter,
      mockTunnel
    )

    expect(mockReporter.error).toHaveBeenCalledWith(
      'The tunnel has stopped working, this may have affected the results.'
    )
  })

  test('location when tunnel', async () => {
    mockApi()

    const mockTunnel = {keepAlive: async () => true} as any

    let results = await waitForResults(
      api,
      trigger,
      [result.test],
      {
        batchTimeout: 2000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: true,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter,
      mockTunnel
    )
    expect((results[0] as BaseResult).location).toBe('Tunneled')

    const newTest = {...result.test}
    newTest.type = 'api'
    newTest.subtype = 'http'
    results = await waitForResults(
      api,
      trigger,
      [newTest],
      {
        batchTimeout: 2000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: true,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter,
      mockTunnel
    )
    expect((results[0] as BaseResult).location).toBe('Tunneled')

    newTest.type = 'api'
    newTest.subtype = 'ssl'
    results = await waitForResults(
      api,
      trigger,
      [newTest],
      {
        batchTimeout: 2000,
        datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
        failOnCriticalErrors: true,
        subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
      },
      mockReporter,
      mockTunnel
    )
    expect((results[0] as BaseResult).location).toBe('Frankfurt (AWS)')
  })

  test('pollResults throws', async () => {
    const {pollResultsMock} = mockApi({
      pollResultsImplementation: () => {
        throw getAxiosError(502, {message: 'Poll results server error'})
      },
    })

    await expect(
      waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).rejects.toThrow(
      'Failed to poll results: could not query https://app.datadoghq.com/example\nPoll results server error\n'
    )

    expect(pollResultsMock).toHaveBeenCalledWith([result.resultId])
  })

  test('getBatch throws', async () => {
    const {getBatchMock} = mockApi({
      getBatchImplementation: () => {
        throw getAxiosError(502, {message: 'Get batch server error'})
      },
    })

    await expect(
      waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )
    ).rejects.toThrow(
      'Failed to get batch: could not query https://app.datadoghq.com/example\nGet batch server error\n'
    )

    expect(getBatchMock).toHaveBeenCalledWith(trigger.batch_id)
  })
})

describe('getResultsToReport', () => {
  test.each([false])('timed out retry - shouldContinuePolling=%s', (shouldContinuePolling: boolean) => {
    const timedOutRetry: ResultInBatch = {
      ...getFailedResultInBatch(),
      retries: 0,
      max_retries: 1,
      timed_out: true, // Can only be true when the backend timed out the batch, i.e. `shouldContinuePolling` is false.
    }

    const batch: Batch = {
      status: 'failed',
      results: [timedOutRetry],
    }

    const resultsToReport = getResultsToReport(
      shouldContinuePolling,
      batch,
      [],
      new Set(['rid']),
      new Set(),
      new Set(),
      mockReporter
    )

    expect(resultsToReport).toStrictEqual([timedOutRetry])
  })

  test.each([false])(
    'timed out retry never emitted before - shouldContinuePolling=%s',
    (shouldContinuePolling: boolean) => {
      const timedOutRetry: ResultInBatch = {
        ...getFailedResultInBatch(),
        retries: 0,
        max_retries: 1,
        timed_out: true, // Can only be true when the backend timed out the batch, i.e. `shouldContinuePolling` is false.
      }

      const batch: Batch = {
        status: 'failed',
        results: [timedOutRetry],
      }

      const resultsToReport = getResultsToReport(
        shouldContinuePolling,
        batch,
        [timedOutRetry],
        new Set(),
        new Set(),
        new Set(),
        mockReporter
      )

      expect(resultsToReport).toStrictEqual([timedOutRetry])
    }
  )
})

describe('reportReceivedResults', () => {
  test('skipped', () => {
    const skippedResult = getSkippedResultInBatch()

    const batch: Batch = {
      status: 'failed',
      results: [skippedResult],
    }

    const emittedResultIds = new Set<string>()
    const receivedResults = reportReceivedResults(batch, emittedResultIds, mockReporter)

    expect(receivedResults).toStrictEqual([skippedResult])
    expect(emittedResultIds).toContain('skipped-0')
    expect(mockReporter.resultReceived).toHaveBeenCalledWith(skippedResult)
  })

  test('final', () => {
    const result = getPassedResultInBatch()

    const batch: Batch = {
      status: 'passed',
      results: [result],
    }

    const emittedResultIds = new Set<string>()
    const receivedResults = reportReceivedResults(batch, emittedResultIds, mockReporter)

    expect(receivedResults).toStrictEqual([result])
    expect(emittedResultIds).toContain('rid')
    expect(mockReporter.resultReceived).toHaveBeenCalledWith(result)
  })

  test('non final', () => {
    const result: ResultInBatch = {
      ...getInProgressResultInBatch(),
      retries: 0,
      max_retries: 1,
    }

    const batch: Batch = {
      status: 'in_progress',
      results: [result],
    }

    const emittedResultIds = new Set<string>()
    const receivedResults = reportReceivedResults(batch, emittedResultIds, mockReporter)

    expect(receivedResults).toStrictEqual([result])
    expect(emittedResultIds).toContain('rid')
    expect(mockReporter.resultReceived).toHaveBeenCalledWith(result)
  })

  test('timed out', () => {
    const timedOut: ResultInBatch = {
      ...getFailedResultInBatch(),
      timed_out: true,
    }

    const batch: Batch = {
      status: 'failed',
      results: [timedOut],
    }

    const emittedResultIds = new Set<string>()
    const receivedResults = reportReceivedResults(batch, emittedResultIds, mockReporter)

    expect(receivedResults).toStrictEqual([timedOut])
    expect(emittedResultIds).toContain('rid')
    expect(mockReporter.resultReceived).toHaveBeenCalledWith(timedOut)
  })
})
