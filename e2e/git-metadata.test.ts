import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('git-metadata', () => {
  it('uploads without errors', async () => {
    const result = await execPromise(`${DATADOG_CI_COMMAND} git-metadata upload`, {
      DD_API_KEY: process.env.DD_API_KEY,
      DATADOG_API_KEY: undefined,
    })

    const output = `${result.stdout}\n${result.stderr}`
    expect(output).not.toContain('Failed getting commits to exclude')
    expect(output).not.toContain('Could not write to GitDB')
    expect(result.exitCode).toBe(0)
  })
})
