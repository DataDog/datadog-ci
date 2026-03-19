import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('sarif', () => {
  it('upload completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sarif upload --service=datadog-ci-e2e-tests-sarif e2e/fixtures/sarif-reports`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
        DATADOG_API_KEY: undefined,
      }
    )

    expect(result.exitCode).toBe(0)
  })
})
