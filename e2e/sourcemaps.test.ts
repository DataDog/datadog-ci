import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'
import {checkSourcemapsUpload} from './helpers/sourcemaps-upload-checker'

const DD_SERVICE = 'e2e-tests'

// Each run and matrix leg uploads under its own release version, so that sourcemaps uploaded by
// earlier runs or by other legs can't satisfy this leg's check.
const RELEASE_VERSION = [
  'e2e',
  process.env.GITHUB_RUN_ID ?? Date.now(),
  process.env.GITHUB_RUN_ATTEMPT ?? 1,
  process.platform,
  process.version,
].join('-')

describe('sourcemaps', () => {
  it('upload completes successfully', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} sourcemaps upload e2e/fixtures/sourcemaps/ --release-version=${RELEASE_VERSION} --service=${DD_SERVICE} --minified-path-prefix=https://e2e-tests.datadoghq.com/static/`,
      {
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_APP_KEY: process.env.DATADOG_APP_KEY,
      }
    )

    expect(result.exitCode).toBe(0)

    await checkSourcemapsUpload({service: DD_SERVICE, version: RELEASE_VERSION})
  })
})
