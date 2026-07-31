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
      fileFixesCompressed: undefined,
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
        url: '/api/v2/cicovreprt',
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
      fileFixesCompressed: undefined,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/"basepath":"\/my\/base\/path"/), {
      filename: 'event.json',
    })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/v2/cicovreprt',
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
      fileFixesCompressed: undefined,
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
      fileFixesCompressed: undefined,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson).not.toHaveProperty('report.flags')
  })

  it('sends file_fixes as gzipped attachment when fileFixesCompressed provided', async () => {
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

    const fileFixesCompressed = Buffer.from('fake-gzipped-data')

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
      fileFixesCompressed,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    // file_fixes should NOT be in event.json
    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])
    expect(eventJson).not.toHaveProperty('file_fixes')

    // file_fixes should be sent as a gzipped attachment
    const fileFixesCall = appendMock.mock.calls.find((call) => call[0] === 'file_fixes')
    expect(fileFixesCall).toBeDefined()
    expect(fileFixesCall[1]).toEqual(fileFixesCompressed)
    expect(fileFixesCall[2]).toEqual({filename: 'file_fixes.json.gz'})
  })

  it('does not send file_fixes attachment when fileFixesCompressed not provided', async () => {
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
      fileFixesCompressed: undefined,
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    // No file_fixes attachment should be sent
    const fileFixesCall = appendMock.mock.calls.find((call) => call[0] === 'file_fixes')
    expect(fileFixesCall).toBeUndefined()

    // And it should not be in event.json either
    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])
    expect(eventJson).not.toHaveProperty('file_fixes')
  })

  describe('coverage config and CODEOWNERS attachments', () => {
    const setUpForm = () => {
      const fsMock = jest.mocked(fs)
      const zlibMock = jest.mocked(zlib)

      const mockStream = new PassThrough()
      fsMock.createReadStream.mockReturnValueOnce(mockStream as unknown as fs.ReadStream)
      zlibMock.createGzip.mockReturnValueOnce(mockStream as unknown as zlib.Gzip)

      const appendMock = jest.fn()
      const formMock = {
        append: appendMock,
        getHeaders: jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'}),
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore override constructor
      FormData.mockImplementation(() => formMock)

      return appendMock
    }

    const basePayload = {
      hostname: 'test-host',
      format: 'jacoco',
      spanTags: {},
      flags: undefined,
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/path/to/report.xml'],
      basePath: undefined,
      fileFixesCompressed: undefined,
    }

    it('sends both attachments with the field names and filenames the backend matches on', async () => {
      const appendMock = setUpForm()
      const configContent = Buffer.from('fake-gzipped-config')
      const codeownersContent = Buffer.from('fake-gzipped-codeowners')

      await uploadCodeCoverageReport(jest.fn().mockResolvedValue({status: 200}))({
        ...basePayload,
        coverageConfig: {
          path: 'code-coverage.datadog.yml',
          sha: 'config-sha',
          gzippedContent: configContent,
          size: 19,
        },
        codeowners: {path: '.github/CODEOWNERS', sha: 'codeowners-sha', gzippedContent: codeownersContent, size: 23},
      })

      const configCall = appendMock.mock.calls.find((call) => call[0] === 'coverage_config')
      expect(configCall[1]).toEqual(configContent)
      expect(configCall[2]).toEqual({filename: 'coverage_config.yml.gz'})

      const codeownersCall = appendMock.mock.calls.find((call) => call[0] === 'codeowners')
      expect(codeownersCall[1]).toEqual(codeownersContent)
      expect(codeownersCall[2]).toEqual({filename: 'codeowners.gz'})

      // the path/sha tags stay on the event, unchanged in meaning
      const eventJson = JSON.parse(appendMock.mock.calls.find((call) => call[0] === 'event')[1])
      expect(eventJson['config.path']).toBe('code-coverage.datadog.yml')
      expect(eventJson['config.sha']).toBe('config-sha')
      expect(eventJson['codeowners.path']).toBe('.github/CODEOWNERS')
      expect(eventJson['codeowners.sha']).toBe('codeowners-sha')
    })

    it('sends no attachment when only the path and sha are known', async () => {
      const appendMock = setUpForm()

      await uploadCodeCoverageReport(jest.fn().mockResolvedValue({status: 200}))({
        ...basePayload,
        coverageConfig: {path: 'code-coverage.datadog.yml', sha: 'config-sha'},
        codeowners: {path: '.github/CODEOWNERS', sha: 'codeowners-sha'},
      })

      expect(appendMock.mock.calls.find((call) => call[0] === 'coverage_config')).toBeUndefined()
      expect(appendMock.mock.calls.find((call) => call[0] === 'codeowners')).toBeUndefined()

      const eventJson = JSON.parse(appendMock.mock.calls.find((call) => call[0] === 'event')[1])
      expect(eventJson['config.sha']).toBe('config-sha')
      expect(eventJson['codeowners.sha']).toBe('codeowners-sha')
    })

    it('attaches the coverage config independently of CODEOWNERS', async () => {
      const appendMock = setUpForm()

      await uploadCodeCoverageReport(jest.fn().mockResolvedValue({status: 200}))({
        ...basePayload,
        coverageConfig: {
          path: 'code-coverage.datadog.yml',
          sha: 'config-sha',
          gzippedContent: Buffer.from('gz'),
          size: 2,
        },
        codeowners: undefined,
      })

      expect(appendMock.mock.calls.find((call) => call[0] === 'coverage_config')).toBeDefined()
      expect(appendMock.mock.calls.find((call) => call[0] === 'codeowners')).toBeUndefined()
    })

    it('sends no attachment when neither file was resolved', async () => {
      const appendMock = setUpForm()

      await uploadCodeCoverageReport(jest.fn().mockResolvedValue({status: 200}))({
        ...basePayload,
        coverageConfig: undefined,
        codeowners: undefined,
      })

      expect(appendMock.mock.calls.find((call) => call[0] === 'coverage_config')).toBeUndefined()
      expect(appendMock.mock.calls.find((call) => call[0] === 'codeowners')).toBeUndefined()

      const eventJson = JSON.parse(appendMock.mock.calls.find((call) => call[0] === 'event')[1])
      expect(eventJson).not.toHaveProperty('config.path')
      expect(eventJson).not.toHaveProperty('codeowners.path')
    })
  })
})
