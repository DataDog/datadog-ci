import deepExtend from 'deep-extend'

import {APIHelper, EndpointError, formatBackendErrors} from './api'
import {BatchTimeoutRunawayError} from './errors'
import {
  BaseResultInBatch,
  Batch,
  MainReporter,
  PollResultMap,
  Result,
  ResultDisplayInfo,
  ResultInBatch,
  Test,
} from './interfaces'
import {isResultInBatchSkippedBySelectiveRerun, getResultIdOrLinkedResultId, hasRetries} from './utils/internal'
import {wait, getAppBaseURL, hasResultPassed} from './utils/public'

const POLLING_INTERVAL = 5000 // In ms

export const waitForBatchToFinish = async (
  api: APIHelper,
  batchId: string,
  maxPollingTimeout: number,
  resultDisplayInfo: ResultDisplayInfo,
  reporter: MainReporter
): Promise<Result[]> => {
  const safeDeadline = Date.now() + maxPollingTimeout + 3 * POLLING_INTERVAL
  const emittedResultIds = new Set<string>()
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

    const {pollResultMap, incompleteResultIds} = await getPollResultMap(api, resultIdsToFetch)

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

const getResultsToReport = (
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
    .filter((r) => isResultInBatchSkippedBySelectiveRerun(r) || !incompleteResultIds.has(r.result_id))
    .concat(newlyCompleteResults)

  if (shouldContinuePolling) {
    return resultsToReport
  }

  // Residual results are either:
  //  - Still in progress (from the batch POV): they were never emitted.
  //  - Or still incomplete (from the poll results POV): report them with their incomplete data and a warning.
  const residualResults = excludeSkipped(batch.results).filter(
    (r) => !emittedResultIds.has(r.result_id) || incompleteResultIds.has(r.result_id)
  )

  const errors: string[] = []
  for (const result of residualResults) {
    if (!result.timed_out) {
      errors.push(`The full information for result ${result.result_id} was incomplete at the end of the batch.`)
    }
  }

  if (errors.length > 0) {
    reporter.error(errors.join('\n') + '\n\n')
  }

  return resultsToReport.concat(residualResults)
}

const reportReceivedResults = (batch: Batch, emittedResultIds: Set<string>, reporter: MainReporter) => {
  const receivedResults: ResultInBatch[] = []

  for (const [index, result] of batch.results.entries()) {
    // Skipped results aren't reported in detail in the terminal output, but they are still reported by `resultReceived()`.
    const resultId = result.status === 'skipped' ? `skipped-${index}` : result.result_id

    // The result is reported if it has a final status, or if it's a non-final result.
    if ((result.status !== 'in_progress' || hasRetries(result)) && !emittedResultIds.has(resultId)) {
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
  pollResultMap: PollResultMap,
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
  pollResultMap: PollResultMap,
  resultDisplayInfo: ResultDisplayInfo,
  safeDeadlineReached = false
): Result => {
  const {getLocation, options, tests} = resultDisplayInfo

  const hasTimedOut = resultInBatch.timed_out ?? safeDeadlineReached

  const test = getTestByPublicId(resultInBatch.test_public_id, tests)

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

  const pollResult = pollResultMap[resultInBatch.result_id]

  if (safeDeadlineReached) {
    pollResult.result.failure = new BatchTimeoutRunawayError().toJson()
    pollResult.result.passed = false
  } else if (hasTimedOut) {
    pollResult.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'}
    pollResult.result.passed = false
  }

  return {
    executionRule: resultInBatch.execution_rule,
    location: getLocation(resultInBatch.location, test),
    passed: hasResultPassed(
      pollResult.result,
      hasTimedOut,
      options.failOnCriticalErrors ?? false,
      options.failOnTimeout ?? false
    ),
    result: pollResult.result,
    resultId: getResultIdOrLinkedResultId(resultInBatch),
    retries: resultInBatch.retries || 0,
    selectiveRerun: resultInBatch.selective_rerun,
    test: deepExtend({}, test, pollResult.check),
    timedOut: hasTimedOut,
    timestamp: pollResult.timestamp,
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

const getPollResultMap = async (api: APIHelper, resultIds: string[]) => {
  try {
    const pollResults = await api.pollResults(resultIds)

    const pollResultMap: PollResultMap = {}
    const incompleteResultIds = new Set<string>()

    pollResults.forEach((r) => {
      // When they are initialized in the backend, results only contain an `eventType: created` property.
      if ('eventType' in r.result && r.result.eventType === 'created') {
        incompleteResultIds.add(r.resultID)
      }
      pollResultMap[r.resultID] = r
    })

    return {pollResultMap, incompleteResultIds}
  } catch (e) {
    throw new EndpointError(`Failed to poll results: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}

const getTestByPublicId = (id: string, tests: Test[]): Test => tests.find((t) => t.public_id === id)!

const getResultIds = (results: ResultInBatch[]): string[] => excludeSkipped(results).map((r) => r.result_id)

const excludeSkipped = (results: ResultInBatch[]) =>
  results.filter((r): r is BaseResultInBatch => !isResultInBatchSkippedBySelectiveRerun(r))
