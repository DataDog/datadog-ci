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
    fsMock.createReadStream.mockReturnValueOnce((mockStream as unknown) as fs.ReadStream)
    zlibMock.createGzip.mockReturnValueOnce((mockStream as unknown) as zlib.Gzip)

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
      customTags: {'custom.tag': 'value'},
      customMeasures: {'custom.measure': 123},
      prDiff: undefined,
      commitDiff: undefined,
      paths: ['/my/path/.resultset.json'],
    }

    const uploader = uploadCodeCoverageReport(requestMock)
    await uploader(payload)

    expect(appendMock).toHaveBeenCalledWith('event', expect.stringMatching(/coverage_report/), {filename: 'event.json'})
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
})
