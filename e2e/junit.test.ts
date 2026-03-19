import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'
import {checkJunitUpload} from './helpers/junit-upload-checker'

const DD_SERVICE = 'datadog-ci-e2e-tests-junit'

describe('junit', () => {
  it('upload with measures (glob expansion)', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} junit upload --service=datadog-ci-e2e-tests-junit **/junit-reports/**/*.xml --measures testmeasure1:20 --report-measures sessionmeasure1:40`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'test',
      extraFilter: '@testmeasure1:20',
    })

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'session',
      extraFilter: '@sessionmeasure1:40',
    })
  })

  it('upload with measures (literal glob string)', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} junit upload --service=datadog-ci-e2e-tests-junit '**/junit-reports/**' --measures testmeasure2:60 --report-measures sessionmeasure2:80`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'test',
      extraFilter: '@testmeasure2:60',
    })

    await checkJunitUpload({
      service: DD_SERVICE,
      commitSha: process.env.GITHUB_SHA!,
      testLevel: 'session',
      extraFilter: '@sessionmeasure2:80',
    })
  })
})
