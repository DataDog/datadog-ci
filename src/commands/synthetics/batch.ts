import deepExtend from 'deep-extend'

import {APIHelper, EndpointError, formatBackendErrors} from './api'
import {SafeDeadlineReachedError} from './errors'
import {
  BaseResultInBatch,
  Batch,
  MainReporter,
  PollResultMap,
  Result,
  ResultDisplayInfo,
  ResultInBatch,
  Test,
  Trigger,
} from './interfaces'
import {isResultInBatchSkippedBySelectiveRerun, getResultIdOrLinkedResultId} from './utils/internal'
import {wait, getAppBaseURL, hasResultPassed} from './utils/public'

const POLLING_INTERVAL = 5000 // In ms

export const waitForBatchToFinish = async (
  api: APIHelper,
  maxPollingTimeout: number,
  trigger: Trigger,
  resultDisplayInfo: ResultDisplayInfo,
  reporter: MainReporter
): Promise<Result[]> => {
  const safeDeadline = Date.now() + maxPollingTimeout + 3 * POLLING_INTERVAL
  const emittedResultIndexes = new Set<number>()
  let oldIncompleteResultIds = new Set<string>()

  while (true) {
    const batch = await getBatch(api, trigger)
    const safeDeadlineReached = Date.now() >= safeDeadline

    // The backend is expected to handle the time out of the batch by eventually changing its status to `failed`.
    // But `safeDeadlineReached` is a safety in case it fails to do that on time.
    const shouldContinuePolling = batch.status === 'in_progress' && !safeDeadlineReached

    const newlyReceivedResults = reportReceivedResults(batch, emittedResultIndexes, reporter)

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
      emittedResultIndexes,
      oldIncompleteResultIds,
      incompleteResultIds,
      reporter
    )

    reportResults(resultsToReport, pollResultMap, resultDisplayInfo, safeDeadlineReached, reporter)

    oldIncompleteResultIds = incompleteResultIds

    if (safeDeadlineReached) {
      throw new SafeDeadlineReachedError()
    }

    if (!shouldContinuePolling) {
      return batch.results.map((r) => getResultFromBatch(r, pollResultMap, resultDisplayInfo))
    }

    reportWaitingTests(trigger, batch, resultDisplayInfo, reporter)

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
  emittedResultIndexes: Set<number>,
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

  const residualResults = excludeSkipped(batch.results).filter(
    (r, index) => !emittedResultIndexes.has(index) || incompleteResultIds.has(r.result_id)
  )

  for (const result of residualResults) {
    reporter.log(`The full information for result ${result.result_id} was incomplete at the end of the batch.`)
  }

  return resultsToReport.concat(residualResults)
}

const reportReceivedResults = (batch: Batch, emittedResultIndexes: Set<number>, reporter: MainReporter) => {
  const receivedResults: ResultInBatch[] = []

  for (const [index, result] of batch.results.entries()) {
    if (result.status !== 'in_progress' && !emittedResultIndexes.has(index)) {
      emittedResultIndexes.add(index)
      reporter.resultReceived(result)
      receivedResults.push(result)
    }
  }

  return receivedResults
}

const reportResults = (
  results: ResultInBatch[],
  pollResultMap: PollResultMap,
  resultDisplayInfo: ResultDisplayInfo,
  safeDeadlineReached: boolean,
  reporter: MainReporter
) => {
  const baseUrl = getAppBaseURL(resultDisplayInfo.options)

  for (const result of results) {
    reporter.resultEnd(getResultFromBatch(result, pollResultMap, resultDisplayInfo, safeDeadlineReached), baseUrl)
  }
}

const reportWaitingTests = (
  trigger: Trigger,
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

  reporter.testsWait(remainingTests, baseUrl, trigger.batch_id, skippedCount)
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
    pollResult.result.failure = new SafeDeadlineReachedError().toJson()
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
    selectiveRerun: resultInBatch.selective_rerun,
    test: deepExtend({}, test, pollResult.check),
    timedOut: hasTimedOut,
    timestamp: pollResult.timestamp,
  }
}

const getBatch = async (api: APIHelper, trigger: Trigger): Promise<Batch> => {
  try {
    const batch = await api.getBatch(trigger.batch_id)

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
