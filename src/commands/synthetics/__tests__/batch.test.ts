import {getResultsToReport} from '../batch'
import {Batch, ResultInBatch} from '../interfaces'

import {getFailedResultInBatch, mockReporter} from './fixtures'

describe('getResultsToReport', () => {
  describe('shouldContinuePolling: false', () => {
    test('timed out retry', () => {
      const timedOutRetry: ResultInBatch = {
        ...getFailedResultInBatch(),
        retries: 0,
        max_retries: 1,
        timed_out: true,
      }

      const batch: Batch = {
        status: 'failed',
        results: [timedOutRetry],
      }

      const resultsToReport = getResultsToReport(false, batch, [], new Set(['rid']), new Set(), new Set(), mockReporter)

      expect(resultsToReport).toStrictEqual([timedOutRetry])
    })
  })
})
