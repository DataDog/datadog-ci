// Asserts the bytes that actually go on the wire, with the real `form-data` and `zlib`.
// The backend matches the coverage config and CODEOWNERS attachments by *filename*, and the intake
// rejects a filename that does not match its attachment-name rules, so both are pinned here rather
// than only asserted through a mocked `form.append`.

import {gunzipSync, gzipSync} from 'zlib'

import type {Payload} from '../interfaces'
import type {RequestConfig} from '@datadog/datadog-ci-base/helpers/request'

import {CODEOWNERS_ATTACHMENT_FILENAME, COVERAGE_CONFIG_ATTACHMENT_FILENAME, uploadCodeCoverageReport} from '../api'

// The intake validates every attachment name against this (Attachment.NAME_PREDICATE in
// logs-backend): segments of [a-zA-Z0-9*_+-] separated by dots, so no leading dot.
const INTAKE_ATTACHMENT_NAME =
  /^\/?(?:[a-zA-Z0-9*_+-]+(?:\.[a-zA-Z0-9*_-]+)*\/)*(?:[a-zA-Z0-9*_+-]+(?:\.[a-zA-Z0-9*_-]+)*)+$/

const CONFIG_CONTENT = 'schema-version: v1\nignore:\n  - "**/generated/**"\n'
const CODEOWNERS_CONTENT = '* @DataDog/apm-ci-app\n'

// No report paths, so every part is a buffer and the whole body can be materialized.
const payloadWithAttachments = (): Payload => ({
  hostname: 'test-host',
  format: 'jacoco',
  spanTags: {},
  flags: undefined,
  paths: [],
  basePath: undefined,
  prDiff: undefined,
  commitDiff: undefined,
  fileFixesCompressed: undefined,
  coverageConfig: {
    path: 'code-coverage.datadog.yml',
    sha: 'a5005d071abcc8cddbaceb06fa80814331a63cb7',
    gzippedContent: gzipSync(Buffer.from(CONFIG_CONTENT)),
    size: CONFIG_CONTENT.length,
  },
  codeowners: {
    path: '.github/CODEOWNERS',
    sha: 'dc2328eaa8c2a1dde843f2e2128c1b3d3c3f566d',
    gzippedContent: gzipSync(Buffer.from(CODEOWNERS_CONTENT)),
    size: CODEOWNERS_CONTENT.length,
  },
})

const captureRequestBody = async (payload: Payload) => {
  let captured: RequestConfig | undefined
  await uploadCodeCoverageReport(async (args) => {
    captured = args

    return {status: 202} as any
  })(payload)

  return (captured!.data as {getBuffer: () => Buffer}).getBuffer().toString('binary')
}

describe('the multipart body sent to the intake', () => {
  test('names the parts and files exactly as the backend expects', async () => {
    const body = await captureRequestBody(payloadWithAttachments())

    expect(body).toContain('name="coverage_config"; filename="coverage_config.yml.gz"')
    expect(body).toContain('name="codeowners"; filename="codeowners.gz"')
    expect(body).toContain('name="event"; filename="event.json"')
  })

  test('uses filenames the intake accepts', () => {
    // a leading dot is the failure mode the report filenames already work around
    expect(COVERAGE_CONFIG_ATTACHMENT_FILENAME).toMatch(INTAKE_ATTACHMENT_NAME)
    expect(CODEOWNERS_ATTACHMENT_FILENAME).toMatch(INTAKE_ATTACHMENT_NAME)
    expect(COVERAGE_CONFIG_ATTACHMENT_FILENAME.startsWith('.')).toBe(false)
    expect(CODEOWNERS_ATTACHMENT_FILENAME.startsWith('.')).toBe(false)
  })

  test('sends gzipped content that round-trips to the original file', async () => {
    const payload = payloadWithAttachments()
    const body = await captureRequestBody(payload)

    expect(gunzipSync(payload.coverageConfig!.gzippedContent!).toString()).toBe(CONFIG_CONTENT)
    expect(gunzipSync(payload.codeowners!.gzippedContent!).toString()).toBe(CODEOWNERS_CONTENT)
    // the gzip magic bytes are present in the body, i.e. the buffer was not stringified
    expect(body).toContain('\x1f\x8b')
  })

  test('stays within the intake attachment budget', async () => {
    const body = await captureRequestBody(payloadWithAttachments())
    const attachments = body.match(/filename="/g) ?? []

    // event.json plus the two files; event.json does not count towards the intake's limit of 10
    expect(attachments).toHaveLength(3)
  })

  test('sends only the event when nothing was resolved', async () => {
    const body = await captureRequestBody({
      ...payloadWithAttachments(),
      coverageConfig: undefined,
      codeowners: undefined,
    })

    expect(body).toContain('filename="event.json"')
    expect(body).not.toContain('coverage_config')
    expect(body).not.toContain('name="codeowners"')
  })

  test('carries the path and sha of both files in the event', async () => {
    const body = await captureRequestBody(payloadWithAttachments())
    const event = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))

    expect(event['config.path']).toBe('code-coverage.datadog.yml')
    expect(event['config.sha']).toBe('a5005d071abcc8cddbaceb06fa80814331a63cb7')
    expect(event['codeowners.path']).toBe('.github/CODEOWNERS')
    expect(event['codeowners.sha']).toBe('dc2328eaa8c2a1dde843f2e2128c1b3d3c3f566d')
  })
})
