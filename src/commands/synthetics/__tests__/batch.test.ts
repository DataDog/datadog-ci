import {getResultsToReport, reportReceivedResults} from '../batch'
import {Batch, ResultInBatch} from '../interfaces'

import {
  getFailedResultInBatch,
  getInProgressResultInBatch,
  getPassedResultInBatch,
  getSkippedResultInBatch,
  mockReporter,
} from './fixtures'

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
