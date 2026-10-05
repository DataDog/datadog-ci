import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'
import {checkJunitUpload} from './helpers/junit-upload-checker'

const DD_SERVICE = 'datadog-ci-e2e-tests-junit'

// Matrix legs (OS x Node version) run in parallel against the same commit SHA and upload with the
// same measure names/values, so without a per-job tag one leg's upload can satisfy another leg's
// check, masking real per-leg failures (e.g. re-running only the failed leg finds nothing).
const JOB_KEY = `${process.platform}-${process.version}`

describe('junit', () => {
  it('upload with measures (glob expansion)', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} junit upload --service=datadog-ci-e2e-tests-junit **/junit-reports/**/*.xml --measures testmeasure1:20 --report-measures sessionmeasure1:40 --tags job:${JOB_KEY} --report-tags job:${JOB_KEY}`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
        DATADOG_API_KEY: undefined,
      }
    )
    expect(result.exitCode).toBe(0)

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'test',
      extraFilter: `@testmeasure1:20 @job:${JOB_KEY}`,
    })

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'session',
      extraFilter: `@sessionmeasure1:40 @job:${JOB_KEY}`,
    })
  })

  // cmd.exe never expands globs (that's a POSIX shell behavior), so on Windows this test would be
  // indistinguishable from "glob expansion" above -- there's no shell-expansion-vs-literal
  // distinction to exercise there.
  if (process.platform !== 'win32') {
    it('upload with measures (literal glob string)', async () => {
      const result = await execPromise(
        `${DATADOG_CI_COMMAND} junit upload --service=datadog-ci-e2e-tests-junit '**/junit-reports/**' --measures testmeasure2:60 --report-measures sessionmeasure2:80 --tags job:${JOB_KEY} --report-tags job:${JOB_KEY}`,
        {
          DD_API_KEY: process.env.DD_API_KEY,
          DATADOG_API_KEY: undefined,
        }
      )
      expect(result.exitCode).toBe(0)

      await checkJunitUpload({
        service: DD_SERVICE,
        commitSha: process.env.GITHUB_SHA!,
        testLevel: 'test',
        extraFilter: `@testmeasure2:60 @job:${JOB_KEY}`,
      })

      await checkJunitUpload({
        service: DD_SERVICE,
        commitSha: process.env.GITHUB_SHA!,
        testLevel: 'session',
        extraFilter: `@sessionmeasure2:80 @job:${JOB_KEY}`,
      })
    })
  }
})
