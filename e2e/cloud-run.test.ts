import crypto from 'node:crypto'

import {checkTelemetryFlowing} from './helpers/cloud-run-telemetry-checker'
import {verifyInstrumented, verifyUninstrumented} from './helpers/cloud-run-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

const describeOrSkip =
  process.env.SKIP_CLOUD_RUN_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

describeOrSkip('cloud-run', () => {
  const project = process.env.GCP_PROJECT_ID!
  const region = process.env.GCP_REGION!
  const runId = crypto.randomBytes(4).toString('hex')
  const serviceName = `dd-e2e-ci-cloud-run-${runId}`

  beforeAll(async () => {
    const result = await execPromiseWithRetries(
      `gcloud run deploy "${serviceName}"` +
        ` --project "${project}"` +
        ` --region "${region}"` +
        ` --platform managed` +
        ` --image ${process.env.GCP_CLOUD_RUN_APP_IMAGE_E2E}` +
        ` --allow-unauthenticated` +
        ` --min-instances 0` +
        ` --max-instances 1` +
        ` --quiet` +
        ` --format=none` +
        ` --labels dd_e2e=true,dd_e2e_tool=ci-cloud-run,dd_e2e_run=${runId},dd_e2e_created=${Math.floor(Date.now() / 1000)}`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to deploy Cloud Run service (exit code ${result.exitCode}): ${result.stderr}`)
    }
  }, 600_000)

  afterAll(async () => {
    try {
      await execPromise(
        `gcloud run services delete "${serviceName}"` +
          ` --project "${project}"` +
          ` --region "${region}"` +
          ` --platform managed` +
          ` --quiet` +
          ` --format=none`
      )
    } catch (error) {
      console.error('Failed to delete ephemeral Cloud Run service:', error)
    }
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} cloud-run instrument` +
        ` --project "${project}"` +
        ` --region "${region}"` +
        ` --service "${serviceName}"` +
        ` --tracing true` +
        ` --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyInstrumented(serviceName, project, region)
  }, 600_000)

  it('telemetry flows', async () => {
    const urlResult = await execPromise(
      `gcloud run services describe "${serviceName}" --project "${project}" --region "${region}" --format="value(status.url)"`
    )
    const serviceUrl = urlResult.stdout.trim()

    await fetch(serviceUrl)

    await checkTelemetryFlowing(serviceName)
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} cloud-run uninstrument` +
        ` --project "${project}"` +
        ` --region "${region}"` +
        ` --service "${serviceName}"`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyUninstrumented(serviceName, project, region)
  }, 600_000)
})
