import fs from 'node:fs'
import path from 'node:path'

import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('sarif', () => {
  it('upload completes successfully', async () => {
    // Use absolute paths to specific files to avoid glob issues in PnP environments
    const sarifDir = path.resolve('e2e/fixtures/sarif-reports')
    const sarifFiles = fs
      .readdirSync(sarifDir)
      .filter((f) => f.endsWith('.sarif'))
      .map((f) => path.join(sarifDir, f))
      .join(' ')

    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sarif upload --service=datadog-ci-e2e-tests-sarif ${sarifFiles}`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
        DATADOG_API_KEY: undefined,
      }
    )

    if (result.exitCode !== 0) {
      console.log('sarif upload stdout:', result.stdout)
      console.log('sarif upload stderr:', result.stderr)
    }
    expect(result.exitCode).toBe(0)
  })
})
