import fs from 'fs'
import {PassThrough} from 'stream'
import zlib from 'zlib'

import FormData from 'form-data'

import {uploadCodeCoverageReport} from '../api'

jest.mock('fs')
jest.mock('zlib')

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({'content-type': 'multipart/form-data'}),
  }))
})

describe('uploadCodeCoverageReport', () => {
  it('removes leading dot from report filenames', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const fsMock = jest.mocked(fs)
    const zlibMock = jest.mocked(zlib)

    const mockStream = new PassThrough()
    fsMock.createReadStream.mockReturnValueOnce(mockStream as unknown as fs.ReadStream)
    zlibMock.createGzip.mockReturnValueOnce(mockStream as unknown as zlib.Gzip)

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      hostname: 'test-host',
      format: 'simplecov-internal',
      spanTags: {},
      flags: ['type:unit-tests', 'jvm-21'],
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/my/path/.resultset.json'],
      basePath: '/my/base/path',
      codeowners: {path: 'CODEOWNERS', sha: 'abc123'},
      coverageConfig: {path: 'coverage.yml', sha: 'bef456'},
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/coverage_report/), {filename: 'event.json'})
    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"codeowners.path":"CODEOWNERS"/), {
      filename: 'event.json',
    })
    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"codeowners.sha":"abc123"/), {
      filename: 'event.json',
    })
    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"config.path":"coverage.yml"/), {
      filename: 'event.json',
    })
    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"config.sha":"bef456"/), {
      filename: 'event.json',
    })
    expect(appendMock).toHaveBeenCalledWith('code_coverage_report_file', mockStream, {filename: 'resultset.json.gz'})

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'api/v2/cicovreprt',
        data: formMock,
        headers: formMock.getHeaders(),
      })
    )
  })

  it('sets base path in event', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const fsMock = jest.mocked(fs)
    const zlibMock = jest.mocked(zlib)

    const mockStream = new PassThrough()
    fsMock.createReadStream.mockReturnValueOnce(mockStream as unknown as fs.ReadStream)
    zlibMock.createGzip.mockReturnValueOnce(mockStream as unknown as zlib.Gzip)

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      hostname: 'test-host',
      format: 'simplecov-internal',
      spanTags: {},
      flags: undefined,
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/my/path/.resultset.json'],
      basePath: '/my/base/path',
      codeowners: {path: 'CODEOWNERS', sha: 'abc123'},
      coverageConfig: {path: 'coverage.yml', sha: 'bef456'},
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"basepath":"\/my\/base\/path"/), {
      filename: 'event.json',
    })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'api/v2/cicovreprt',
        data: formMock,
        headers: formMock.getHeaders(),
      })
    )
  })

  it('includes report.flags in event when flags provided', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const fsMock = jest.mocked(fs)
    const zlibMock = jest.mocked(zlib)

    const mockStream = new PassThrough()
    fsMock.createReadStream.mockReturnValueOnce(mockStream as unknown as fs.ReadStream)
    zlibMock.createGzip.mockReturnValueOnce(mockStream as unknown as zlib.Gzip)

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      hostname: 'test-host',
      format: 'jacoco',
      spanTags: {},
      flags: ['type:unit-tests', 'jvm-21'],
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/path/to/report.xml'],
      basePath: undefined,
      codeowners: undefined,
      coverageConfig: undefined,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson['report.flags']).toEqual(['type:unit-tests', 'jvm-21'])
  })

  it('does not include report.flags when flags not provided', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const fsMock = jest.mocked(fs)
    const zlibMock = jest.mocked(zlib)

    const mockStream = new PassThrough()
    fsMock.createReadStream.mockReturnValueOnce(mockStream as unknown as fs.ReadStream)
    zlibMock.createGzip.mockReturnValueOnce(mockStream as unknown as zlib.Gzip)

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      hostname: 'test-host',
      format: 'jacoco',
      spanTags: {},
      flags: undefined,
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/path/to/report.xml'],
      basePath: undefined,
      codeowners: undefined,
      coverageConfig: undefined,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson).not.toHaveProperty('report.flags')
  })
})
