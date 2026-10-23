import fsp from 'fs/promises'

import type {CommandContext} from '@datadog/datadog-ci-base'
import type {Writable} from 'stream'

import type {Args} from '../../reporters/json'
import {JSONReporter} from '../../reporters/json'

import {getBrowserResult, getBrowserTest} from '../fixtures'

describe('JSON reporter', () => {
  const writeMock: Writable['write'] = jest.fn()
  const commandMock: Args = {
    context: {stdout: {write: writeMock}} as unknown as CommandContext,
    jsonReport: 'report',
  }

  let reporter: JSONReporter

  beforeEach(() => {
    reporter = new JSONReporter(commandMock)
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  test("should append '.json' to destination if it isn't there", () => {
    expect(reporter['destination']).toBe('report.json')
  })

  test('should write only the fields exposed in the JUnit report to disk', async () => {
    const result = getBrowserResult('1', getBrowserTest('abc-def-ghi'))

    reporter.resultEnd(result)
    reporter.runEnd()

    const expectedResult = {
      test: {
        name: 'Test name',
        type: 'browser',
        public_id: 'abc-def-ghi',
        message: '',
        monitor_id: 0,
        status: 'live',
        tags: [],
      },
      resultId: '1',
      executionRule: 'blocking',
      passed: true,
      timedOut: false,
      duration: 1000,
      location: 'Frankfurt (AWS)',
      retries: 0,
      maxRetries: 0,
      device: {
        id: 'chrome.laptop_large',
        resolution: {width: 1440, height: 1100},
      },
      result: {
        finished_at: 1,
        start_url: '',
        steps: [],
      },
    }

    await expect(fsp.readFile('report.json', 'utf8')).resolves.toBe(
      JSON.stringify({results: [expectedResult]}, undefined, 2)
    )

    await fsp.unlink('report.json')
  })

  test('should not expose fields that are not exposed in the JUnit report', async () => {
    const result = getBrowserResult('1', getBrowserTest('abc-def-ghi'))

    reporter.resultEnd(result)
    reporter.runEnd()

    const written = JSON.parse(await fsp.readFile('report.json', 'utf8')) as {results: [{test: object}]}
    const [{test}] = written.results

    // `test.config`/`test.locations`/`test.options` (beyond `options.ci.executionRule`) are part of the test's
    // full definition, but JUnit never surfaces them, so neither should the JSON report.
    expect(test).not.toHaveProperty('config')
    expect(test).not.toHaveProperty('locations')
    expect(test).not.toHaveProperty('options.device_ids')

    await fsp.unlink('report.json')
  })

  test('should skip non-final results', async () => {
    const result = {...getBrowserResult('1', getBrowserTest('abc-def-ghi')), isNonFinal: true}

    reporter.resultEnd(result)
    reporter.runEnd()

    await expect(fsp.readFile('report.json', 'utf8')).resolves.toBe(JSON.stringify({results: []}, undefined, 2))

    await fsp.unlink('report.json')
  })
})
