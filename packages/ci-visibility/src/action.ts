import {randomUUID} from 'node:crypto'
import {appendFileSync, chmodSync, mkdtempSync} from 'node:fs'
import {join} from 'node:path'

import {uploadDirectory} from './collector'
import {warn} from './validation'

const writeCommand = (file: string | undefined, name: string, value: string) => {
  if (!file) {
    throw new Error('Missing runner command file')
  }
  const delimiter = randomUUID()
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}

export const setupAction = (): void => {
  try {
    if (!process.env.RUNNER_TEMP) {
      throw new Error('Missing RUNNER_TEMP')
    }
    const directory = mkdtempSync(join(process.env.RUNNER_TEMP, 'dd-ci-visibility-'))
    chmodSync(directory, 0o700)
    writeCommand(process.env.GITHUB_STATE, 'ci-visibility-directory', directory)
    writeCommand(process.env.GITHUB_ENV, 'DD_CI_BUFFER_DIR', directory)
  } catch {
    warn(undefined, 'Recorder setup unavailable')
  }
}

export const postAction = async (): Promise<void> => {
  const directory = process.env['STATE_ci-visibility-directory']
  if (!directory) {
    return
  }
  const dryRun = process.env['INPUT_DRY-RUN'] || 'false'
  if (!['true', 'false'].includes(dryRun)) {
    warn(undefined, 'Upload skipped: dry-run must be true or false')

    return
  }
  const result = await uploadDirectory(directory, {
    apiKey: process.env['INPUT_API-KEY'] || process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    site: process.env.INPUT_SITE || process.env.DATADOG_SITE || process.env.DD_SITE,
    timeoutMs: Number(process.env['INPUT_UPLOAD-TIMEOUT-MS'] || '10000'),
    dryRun: dryRun === 'true',
  })
  console.log(
    `CI Visibility: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped; dry-run=${dryRun}`
  )
}
