import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('synthetics', () => {
  it('run-tests completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} synthetics run-tests --config e2e/fixtures/global.config.json`,
      {
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_APP_KEY: process.env.DATADOG_APP_KEY,
      }
    )

    expect(result.exitCode).toBe(0)
  })

  it('importing exposed plugin API works', async () => {
    const {executeTests} = require('@datadog/datadog-ci-plugin-synthetics')
    expect(executeTests).toBeDefined()
  })
})
