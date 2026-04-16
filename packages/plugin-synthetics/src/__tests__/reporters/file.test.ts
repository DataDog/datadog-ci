import fs from 'fs'
import fsp from 'fs/promises'

import type {CommandContext} from '@datadog/datadog-ci-base'
import type {Writable} from 'stream'

import {FileReporter} from '../../reporters/file'

class TestFileReporter extends FileReporter {
  constructor(write: Writable['write'], destination: string, defaultExtension = '.txt') {
    super({
      context: {stdout: {write}} as unknown as CommandContext,
      defaultExtension,
      destination,
      reportName: 'test report',
    })
  }

  public save(contents: string) {
    this.writeReportToFile(contents)
  }
}

describe('FileReporter', () => {
  const writeMock: Writable['write'] = jest.fn()

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  test("should append the file extension when it isn't there", () => {
    const reporter = new TestFileReporter(writeMock, 'report')

    expect(reporter['destination']).toBe('report.txt')
  })

  test('should write the file and create parent directories', async () => {
    const reporter = new TestFileReporter(writeMock, 'reports/output')

    reporter.save('hello')

    await expect(fsp.readFile('reports/output.txt', 'utf8')).resolves.toBe('hello')

    await fsp.unlink('reports/output.txt')
    await fsp.rmdir('reports')
  })

  test('should gracefully handle write failures', () => {
    const reporter = new TestFileReporter(writeMock, 'report')
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('Fail')
    })

    reporter.save('hello')

    expect(writeMock).toHaveBeenCalledTimes(1)
  })
})
