import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('sourcemaps', () => {
  it('upload completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sourcemaps upload e2e/fixtures/sourcemaps/ --release-version=e2e --service=e2e-tests --minified-path-prefix=https://e2e-tests.datadoghq.com/static/`,
      {
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_APP_KEY: process.env.DATADOG_APP_KEY,
      }
    )

    expect(result.exitCode).toBe(0)
  })
})
