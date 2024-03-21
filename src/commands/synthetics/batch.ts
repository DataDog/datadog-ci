import deepExtend from 'deep-extend'

import {APIHelper, EndpointError, formatBackendErrors} from './api'
import {Batch, MainReporter, PollResultMap, Result, ResultDisplayInfo, ResultInBatch, Test, Trigger} from './interfaces'
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
  const maxPollingDate = Date.now() + maxPollingTimeout
  const emittedResultIndexes = new Set<number>()

  while (true) {
    const batch = await getBatch(api, trigger)
    const hasBatchExceededMaxPollingDate = Date.now() >= maxPollingDate

    // The backend is expected to handle the time out of the batch by eventually changing its status to `failed`.
    // But `hasBatchExceededMaxPollingDate` is a safety in case it fails to do that.
    const shouldContinuePolling = batch.status === 'in_progress' && !hasBatchExceededMaxPollingDate

    const receivedResults = reportReceivedResults(batch, emittedResultIndexes, reporter)
    const residualResults = batch.results.filter((_, index) => !emittedResultIndexes.has(index))

    // For the last iteration, the full up-to-date data has to be fetched to compute this function's return value,
    // while only the [received + residual] results have to be reported.
    const resultIdsToFetch = (shouldContinuePolling ? receivedResults : batch.results).flatMap((r) =>
      isResultInBatchSkippedBySelectiveRerun(r) ? [] : [r.result_id]
    )
    const resultsToReport = receivedResults.concat(shouldContinuePolling ? [] : residualResults)

    const pollResultMap = await getPollResultMap(api, resultIdsToFetch)

    reportResults(resultsToReport, pollResultMap, resultDisplayInfo, hasBatchExceededMaxPollingDate, reporter)

    if (!shouldContinuePolling) {
      return batch.results.map((r) =>
        getResultFromBatch(r, pollResultMap, resultDisplayInfo, hasBatchExceededMaxPollingDate)
      )
    }

    reportWaitingTests(trigger, batch, resultDisplayInfo, reporter)

    await wait(POLLING_INTERVAL)
  }
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
  hasBatchExceededMaxPollingDate: boolean,
  reporter: MainReporter
) => {
  const baseUrl = getAppBaseURL(resultDisplayInfo.options)

  for (const result of results) {
    reporter.resultEnd(
      getResultFromBatch(result, pollResultMap, resultDisplayInfo, hasBatchExceededMaxPollingDate),
      baseUrl
    )
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
  hasBatchExceededMaxPollingDate: boolean
): Result => {
  const {getLocation, options, tests} = resultDisplayInfo

  const hasTimedOut = resultInBatch.timed_out ?? hasBatchExceededMaxPollingDate

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

  if (hasTimedOut) {
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

const getTestByPublicId = (id: string, tests: Test[]): Test => tests.find((t) => t.public_id === id)!

const getPollResultMap = async (api: APIHelper, resultIds: string[]) => {
  try {
    const pollResults = await api.pollResults(resultIds)
    const pollResultMap: PollResultMap = {}
    pollResults.forEach((r) => (pollResultMap[r.resultID] = r))

    return pollResultMap
  } catch (e) {
    throw new EndpointError(`Failed to poll results: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}
