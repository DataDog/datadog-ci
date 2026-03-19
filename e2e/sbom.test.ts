import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('sbom', () => {
  it('upload completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sbom upload --service=datadog-ci-e2e-tests-sbom --env test e2e/fixtures/sbom-reports/sbom.json`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
        DD_APP_KEY: process.env.DD_APP_KEY,
      }
    )

    expect(result.exitCode).toBe(0)
  })
})
