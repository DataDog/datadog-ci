import chalk from 'chalk'
import deepExtend from 'deep-extend'

import {Metadata} from '../../helpers/interfaces'

import {
  APIHelper,
  EndpointError,
  extractUnauthorizedTestPublicIds,
  formatBackendErrors,
  getErrorHttpStatus,
} from './api'
import {BatchTimeoutRunawayError, CiError} from './errors'
import {
  BaseResultInBatch,
  Batch,
  LocationsMapping,
  MainReporter,
  Payload,
  PollResult,
  Result,
  ResultDisplayInfo,
  ResultInBatch,
  ServerResult,
  Test,
  TestPayload,
  TriggerInfo,
} from './interfaces'
import {Tunnel} from './tunnel'
import {
  isResultInBatchSkippedBySelectiveRerun,
  getResultIdOrLinkedResultId,
  hasResultPassed,
  isTimedOutRetry,
  isNonFinalResult,
  getPublicIdOrPlaceholder,
  wait,
} from './utils/internal'
import {getAppBaseURL, isTestSupportedByTunnel} from './utils/public'

export const DEFAULT_BATCH_TIMEOUT = 30 * 60 * 1000

const POLLING_INTERVAL = 5000 // In ms

export const runTests = async (
  api: APIHelper,
  testsToTrigger: TestPayload[],
  reporter: MainReporter,
  metadata?: Metadata,
  failOnMissingTests?: boolean,
  selectiveRerun?: boolean,
  batchTimeout = DEFAULT_BATCH_TIMEOUT
): Promise<TriggerInfo> => {
  const payload: Payload = {
    tests: testsToTrigger,
    metadata,
    options: {
      batch_timeout: batchTimeout,
      selective_rerun: selectiveRerun,
    },
  }

  try {
    const response = await api.triggerTests(payload)

    return {
      batchId: response.batch_id,
      locations: response.locations,
      selectiveRerunRateLimited: response.selective_rerun_rate_limited,
      testsNotAuthorized: new Set(),
    }
  } catch (e) {
    const errorMessage = formatBackendErrors(e)
    const unauthorizedTestPublicIds = extractUnauthorizedTestPublicIds(e)

    if (unauthorizedTestPublicIds?.size) {
      // Abort if `failOnMissingTests` is true.
      if (failOnMissingTests) {
        reporter.error(
          `${chalk.red.bold(
            'Some tests were not authorized to be triggered. Aborting due to `failOnCriticalErrors: true`.'
          )}\n  Error: ${errorMessage}\n\n`
        )

        const testsNotAuthorizedListStr = chalk.gray([...unauthorizedTestPublicIds].join(', '))
        throw new CiError('UNAUTHORIZED_TESTS', testsNotAuthorizedListStr)
      }

      // Retry without unauthorized tests.
      reporter.error(
        `${chalk.red.bold(
          'Some tests were not authorized to be triggered, retrying without them…'
        )}\n  Error: ${errorMessage}\n\n`
      )
      const newTestsToTrigger = testsToTrigger.filter(
        (t) => !unauthorizedTestPublicIds.has(getPublicIdOrPlaceholder(t))
      )
      const trigger = await runTests(
        api,
        newTestsToTrigger,
        reporter,
        metadata,
        failOnMissingTests,
        selectiveRerun,
        batchTimeout
      )

      return {
        ...trigger,
        testsNotAuthorized: new Set([...unauthorizedTestPublicIds, ...trigger.testsNotAuthorized]),
      }
    }

    // Rewrite error message
    const testIds = testsToTrigger.map((t) => getPublicIdOrPlaceholder(t)).join(',')
    throw new EndpointError(`[${testIds}] Failed to trigger tests: ${errorMessage}\n`, e.response?.status)
  }
}

export const waitForResults = async (
  api: APIHelper,
  trigger: TriggerInfo,
  tests: Test[],
  options: ResultDisplayInfo['options'],
  reporter: MainReporter,
  tunnel?: Tunnel
): Promise<Result[]> => {
  let isTunnelConnected = true
  if (tunnel) {
    tunnel
      .keepAlive()
      .then(() => (isTunnelConnected = false))
      .catch(() => (isTunnelConnected = false))
  }

  reporter.testsWait(tests, getAppBaseURL(options), trigger.batchId)

  const locationNames = trigger.locations.reduce<LocationsMapping>((mapping, location) => {
    mapping[location.name] = location.display_name

    return mapping
  }, {})

  const getLocation = (dcId: string, test: Test) => {
    const hasTunnel = !!tunnel && isTestSupportedByTunnel(test)

    return hasTunnel ? 'Tunneled' : locationNames[dcId] || dcId
  }

  const resultDisplayInfo = {
    getLocation,
    options,
    tests,
  }

  const results = await waitForBatchToFinish(api, trigger.batchId, options.batchTimeout, resultDisplayInfo, reporter)

  if (tunnel && !isTunnelConnected) {
    reporter.error('The tunnel has stopped working, this may have affected the results.')
  }

  return results
}

const waitForBatchToFinish = async (
  api: APIHelper,
  batchId: string,
  batchTimeout: number,
  resultDisplayInfo: ResultDisplayInfo,
  reporter: MainReporter
): Promise<Result[]> => {
  const safeDeadline = Date.now() + batchTimeout + 12 * POLLING_INTERVAL
  const emittedResultIds = new Set<string>()
  const backupPollResultMap = new Map<string, PollResult>()

  let oldIncompleteResultIds = new Set<string>()

  while (true) {
    const batch = await getBatch(api, batchId)
    const safeDeadlineReached = Date.now() >= safeDeadline

    // The backend is expected to handle the time out of the batch by eventually changing its status to `failed`.
    // But `safeDeadlineReached` is a safety in case it fails to do that on time.
    const shouldContinuePolling = batch.status === 'in_progress' && !safeDeadlineReached

    const newlyReceivedResults = reportReceivedResults(batch, emittedResultIds, reporter)

    const resultIdsToFetch = getResultIdsToFetch(
      shouldContinuePolling,
      batch,
      newlyReceivedResults,
      oldIncompleteResultIds
    )

    const {pollResultMap, incompleteResultIds} = await getPollResultMap(api, resultIdsToFetch, backupPollResultMap)

    const resultsToReport = getResultsToReport(
      shouldContinuePolling,
      batch,
      newlyReceivedResults,
      emittedResultIds,
      oldIncompleteResultIds,
      incompleteResultIds,
      reporter
    )

    reportResults(batchId, resultsToReport, pollResultMap, resultDisplayInfo, safeDeadlineReached, reporter)

    oldIncompleteResultIds = incompleteResultIds

    if (safeDeadlineReached) {
      throw new BatchTimeoutRunawayError()
    }

    if (!shouldContinuePolling) {
      return batch.results.map((r) => getResultFromBatch(r, pollResultMap, resultDisplayInfo))
    }

    reportWaitingTests(batchId, batch, resultDisplayInfo, reporter)

    await wait(POLLING_INTERVAL)
  }
}

const getResultIdsToFetch = (
  shouldContinuePolling: boolean,
  batch: Batch,
  newlyReceivedResults: ResultInBatch[],
  oldIncompleteResultIds: Set<string>
): string[] => {
  // For the last iteration, the full up-to-date data has to be fetched to compute the return value of `waitForResults()`.
  if (!shouldContinuePolling) {
    return getResultIds(batch.results)
  }

  return getResultIds(newlyReceivedResults).concat(...oldIncompleteResultIds)
}

export const getResultsToReport = (
  shouldContinuePolling: boolean,
  batch: Batch,
  newlyReceivedResults: ResultInBatch[],
  emittedResultIds: Set<string>,
  oldIncompleteResultIds: Set<string>,
  incompleteResultIds: Set<string>,
  reporter: MainReporter
): ResultInBatch[] => {
  const newlyCompleteResults = excludeSkipped(batch.results).filter(
    (r) => oldIncompleteResultIds.has(r.result_id) && !incompleteResultIds.has(r.result_id)
  )

  const resultsToReport = newlyReceivedResults
    .filter(
      (r) => isResultInBatchSkippedBySelectiveRerun(r) || !isResidualResult(r, emittedResultIds, incompleteResultIds)
    )
    .concat(newlyCompleteResults)

  if (shouldContinuePolling) {
    return resultsToReport
  }

  // Results that we failed to report for some reason are finally reported as "residues".
  const residualResults = excludeSkipped(batch.results).filter((r) =>
    isResidualResult(r, emittedResultIds, incompleteResultIds)
  )

  const errors: string[] = []
  for (const result of residualResults) {
    if (!result.timed_out) {
      errors.push(
        `The information for result ${result.result_id} of test ${result.test_public_id} was incomplete at the end of the batch.`
      )
    }
  }

  if (errors.length > 0) {
    reporter.error(errors.join('\n') + '\n\n')
  }

  return resultsToReport.concat(residualResults)
}

export const reportReceivedResults = (batch: Batch, emittedResultIds: Set<string>, reporter: MainReporter) => {
  const receivedResults: ResultInBatch[] = []

  for (const [index, result] of batch.results.entries()) {
    // Skipped results are only reported by `resultReceived()`, then they are excluded everywhere with `excludeSkipped()`.
    const resultId = result.status === 'skipped' ? `skipped-${index}` : result.result_id

    // The result is reported if it has a final status, or if it's a non-final result.
    if ((result.status !== 'in_progress' || isNonFinalResult(result)) && !emittedResultIds.has(resultId)) {
      emittedResultIds.add(resultId)
      reporter.resultReceived(result)
      receivedResults.push(result)
    }
  }

  return receivedResults
}

const reportResults = (
  batchId: string,
  results: ResultInBatch[],
  pollResultMap: Map<string, PollResult>,
  resultDisplayInfo: ResultDisplayInfo,
  safeDeadlineReached: boolean,
  reporter: MainReporter
) => {
  const baseUrl = getAppBaseURL(resultDisplayInfo.options)

  for (const result of results) {
    reporter.resultEnd(
      getResultFromBatch(result, pollResultMap, resultDisplayInfo, safeDeadlineReached),
      baseUrl,
      batchId
    )
  }
}

const reportWaitingTests = (
  batchId: string,
  batch: Batch,
  resultDisplayInfo: ResultDisplayInfo,
  reporter: MainReporter
) => {
  const baseUrl = getAppBaseURL(resultDisplayInfo.options)
  const {tests} = resultDisplayInfo

  const inProgressPublicIds = new Set()
  const skippedBySelectiveRerunPublicIds = new Set()

  for (const result of batch.results) {
    if (result.status === 'in_progress') {
      inProgressPublicIds.add(result.test_public_id)
    }
    if (isResultInBatchSkippedBySelectiveRerun(result)) {
      skippedBySelectiveRerunPublicIds.add(result.test_public_id)
    }
  }

  const remainingTests = []
  let skippedCount = 0

  for (const test of tests) {
    if (inProgressPublicIds.has(test.public_id)) {
      remainingTests.push(test)
    }
    if (skippedBySelectiveRerunPublicIds.has(test.public_id)) {
      skippedCount++
    }
  }

  reporter.testsWait(remainingTests, baseUrl, batchId, skippedCount)
}

const getResultFromBatch = (
  resultInBatch: ResultInBatch,
  pollResultMap: Map<string, PollResult>,
  resultDisplayInfo: ResultDisplayInfo,
  safeDeadlineReached = false
): Result => {
  const {tests} = resultDisplayInfo
  const test = getTestByPublicId(resultInBatch.test_public_id, tests)

  const hasTimedOut = resultInBatch.timed_out ?? safeDeadlineReached
  const timedOutRetry = isTimedOutRetry(resultInBatch.retries, resultInBatch.max_retries, resultInBatch.timed_out)

  if (isResultInBatchSkippedBySelectiveRerun(resultInBatch)) {
    return {
      executionRule: resultInBatch.execution_rule,
      passed: true,
      resultId: getResultIdOrLinkedResultId(resultInBatch),
      selectiveRerun: resultInBatch.selective_rerun,
      test,
      timedOut: hasTimedOut,
    }
  }

  const pollResult = pollResultMap.get(resultInBatch.result_id)
  const isUnhealthy = pollResult?.result?.unhealthy ?? false
  if (!pollResult?.result) {
    return createResult(resultInBatch, pollResult, test, hasTimedOut, isUnhealthy, resultDisplayInfo)
  }

  if (safeDeadlineReached) {
    pollResult.result.failure = new BatchTimeoutRunawayError().toJson()
    pollResult.result.status = 'failed'
  } else if (timedOutRetry) {
    pollResult.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the retry.'}
    pollResult.result.status = 'failed'
  } else if (hasTimedOut) {
    pollResult.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'}
    pollResult.result.status = 'failed'
  }

  return createResult(resultInBatch, pollResult, test, hasTimedOut, isUnhealthy, resultDisplayInfo)
}

const createResult = (
  resultInBatch: BaseResultInBatch,
  pollResult: PollResult | undefined,
  test: Test,
  hasTimedOut: boolean,
  isUnhealthy: boolean,
  {getLocation, options}: Pick<ResultDisplayInfo, 'getLocation' | 'options'>
): Result => {
  return {
    device: pollResult?.device,
    duration: resultInBatch.duration,
    executionRule: resultInBatch.execution_rule,
    initialResultId: resultInBatch.initial_result_id,
    isNonFinal: isNonFinalResult(resultInBatch),
    location: getLocation(resultInBatch.location, test),
    passed: hasResultPassed(resultInBatch, isUnhealthy, hasTimedOut, options),
    result: pollResult?.result,
    resultId: getResultIdOrLinkedResultId(resultInBatch),
    retries: resultInBatch.retries || 0,
    maxRetries: resultInBatch.max_retries || 0,
    selectiveRerun: resultInBatch.selective_rerun,
    test: deepExtend({}, test, pollResult?.test),
    timedOut: hasTimedOut,
    timestamp: pollResult?.result?.finished_at ?? Date.now(),
  }
}

const getBatch = async (api: APIHelper, batchId: string): Promise<Batch> => {
  try {
    const batch = await api.getBatch(batchId)

    return batch
  } catch (e) {
    throw new EndpointError(`Failed to get batch: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}

/**
 * Returns fresh poll results, or reads the backup map in case of 404.
 */
const getPollResultMap = async (api: APIHelper, resultIds: string[], backupPollResultMap: Map<string, PollResult>) => {
  const pollResultMap = new Map<string, PollResult>()
  const incompleteResultIds = new Set<string>()

  try {
    const pollResults = await api.pollResults(resultIds)

    pollResults.forEach((r) => {
      // Server results can take some time to arrive. During this time,
      // the endpoint returns a partial result with only `test_type` and `result.id` set.
      // We keep the `PollResult` but remove the `ServerResult` to avoid reporting incomplete data.
      if (r.result && !('finished_at' in (r.result as Partial<ServerResult>))) {
        incompleteResultIds.add(r.resultID)
        delete r.result
      }
      pollResultMap.set(r.resultID, r)
      backupPollResultMap.set(r.resultID, r)
    })

    return {pollResultMap, incompleteResultIds}
  } catch (e) {
    if (getErrorHttpStatus(e) === 404) {
      // If some results have latency and retries were not enough, the whole request fails with "Test results not found".
      // In that case, we mark results IDs that were never polled before as incomplete so they are fetched in the next polling cycles.
      resultIds.forEach((resultId) => {
        const backupPollResult = backupPollResultMap.get(resultId)
        if (backupPollResult) {
          pollResultMap.set(resultId, backupPollResult)
        } else {
          incompleteResultIds.add(resultId)
        }
      })

      return {pollResultMap, incompleteResultIds}
    }

    throw new EndpointError(`Failed to poll results: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}

/**
 * A residual result is either:
 * - Still incomplete (from the poll results POV): report it with incomplete data and a warning.
 * - Still in progress (from the batch POV): it was never emitted.
 * - A timed out retry.
 */
const isResidualResult = (
  result: BaseResultInBatch,
  emittedResultIds: Set<string>,
  incompleteResultIds: Set<string>
) => {
  if (incompleteResultIds.has(result.result_id)) {
    // The poll results endpoint returned an incomplete result: report it with incomplete data and a warning.
    return true
  }
  if (!emittedResultIds.has(result.result_id)) {
    // Was never emitted, which means the batch never set a final status for it.
    return true
  }
  if (emittedResultIds.has(result.result_id) && isTimedOutRetry(result.retries, result.max_retries, result.timed_out)) {
    // The result ID was already emitted but it used to be non-final result, and it's now a timed out retry.
    return true
  }

  return false
}

const getTestByPublicId = (id: string, tests: Test[]): Test => tests.find((t) => t.public_id === id)!

const getResultIds = (results: ResultInBatch[]): string[] => excludeSkipped(results).map((r) => r.result_id)

const excludeSkipped = (results: ResultInBatch[]) =>
  results.filter((r): r is BaseResultInBatch => !isResultInBatchSkippedBySelectiveRerun(r))
