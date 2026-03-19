import path from 'node:path'

import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('sarif', () => {
  it('upload completes successfully', async () => {
    const sarifDir = path.resolve('e2e/fixtures/sarif-reports')
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sarif upload --service=datadog-ci-e2e-tests-sarif ${sarifDir}`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
        DATADOG_API_KEY: undefined,
      }
    )

    if (result.exitCode !== 0) {
      console.log('sarif upload stdout:', result.stdout)
      console.log('sarif upload stderr:', result.stderr)

      // Debug: check directory contents from jest process
      const fs = await import('node:fs')
      console.log('CWD:', process.cwd())
      console.log('sarifDir:', sarifDir)
      console.log('dir exists:', fs.existsSync(sarifDir))
      if (fs.existsSync(sarifDir)) {
        console.log('dir contents:', fs.readdirSync(sarifDir))
      }
    }
    expect(result.exitCode).toBe(0)
  })
})
