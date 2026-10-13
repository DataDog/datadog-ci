import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

const describeOrSkip = process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

describe('synthetics', () => {
  it('run-tests completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} synthetics run-tests --config e2e/fixtures/global.config.json`,
      {
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_APP_KEY: process.env.DATADOG_APP_KEY,
      }
    )

    // Assert the 2 tests defined in `e2e/fixtures/tests.synthetics.json` were resolved
    // through the glob pattern defined in `e2e/fixtures/global.config.json`
    expect(result.stdout).toContain('pwd-mwg-3p5')
    expect(result.stdout).toContain('2r9-q7u-4nn')

    // Assert it was successful
    expect(result.stdout).toContain('View full summary in Datadog')
    expect(result.exitCode).toBe(0)
  })
})

describeOrSkip('synthetics plugin API', () => {
  it('importing exposed plugin API works', async () => {
    const {executeTests} = require('@datadog/datadog-ci-plugin-synthetics')
    expect(executeTests).toBeDefined()
  })
})
