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

  test('should write final results to disk', async () => {
    const result = getBrowserResult('1', getBrowserTest('abc-def-ghi'))

    reporter.resultEnd(result)
    reporter.runEnd()

    await expect(fsp.readFile('report.json', 'utf8')).resolves.toBe(JSON.stringify({results: [result]}, undefined, 2))

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
