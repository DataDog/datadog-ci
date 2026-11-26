import fs from 'fs'
import os from 'os'
import {gunzipSync} from 'zlib'

import type {Payload} from '../interfaces'

import upath from 'upath'

import {uploadJUnitXML} from '../api'

// The gzipped report inside the multipart form the upload sends.
const sentReport = async (form: any): Promise<string> => {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    form.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    form.on('end', resolve)
    form.on('error', reject)
    form.resume()
  })
  const body = Buffer.concat(chunks)
  const start = body.indexOf(Buffer.from([0x1f, 0x8b]))
  const end = body.indexOf(Buffer.from(`\r\n--${form.getBoundary()}`), start)

  return gunzipSync(body.subarray(start, end)).toString()
}

describe('uploadJUnitXML', () => {
  const xmlPath = upath.join(fs.mkdtempSync(upath.join(os.tmpdir(), 'junit-api-')), 'report.xml')
  fs.writeFileSync(xmlPath, '<testsuite name="from-file"/>')
  const payload = (xmlContent?: string): Payload => ({
    hostname: 'host',
    logsEnabled: false,
    spanTags: {},
    customTags: {},
    customMeasures: {},
    reportTags: {},
    reportMeasures: {},
    xmlPath,
    xmlContent,
  })

  test('sends the file as it is without a tagged copy, and the tagged copy on every attempt when there is one', async () => {
    const sent: string[] = []
    const request = jest.fn(async ({data}: any) => {
      sent.push(await sentReport(data))

      return {data: {}} as any
    })
    const upload = uploadJUnitXML(request, () => 'id' as any)

    await upload(payload())
    await upload(payload('<testsuite name="tagged"/>'))
    await upload(payload('<testsuite name="tagged"/>'))

    expect(sent).toEqual(['<testsuite name="from-file"/>', '<testsuite name="tagged"/>', '<testsuite name="tagged"/>'])
  })
})
