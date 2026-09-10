import crypto from 'node:crypto'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {SSI_CASES as ssiCases} from '../helpers/ssi'
import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {verifyMultiLanguageSsiInstrumented, verifySsiInstrumented} from './cloud-run-verifier'

const describeOrSkip =
  process.env.SKIP_CLOUD_RUN_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

const SSI_CASES = ssiCases.map(({fixtureImageName, nativeEnv, ...ssiCase}) => ({
  ...ssiCase,
  image: `us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/${fixtureImageName}:latest`,
  envName: nativeEnv.name,
  envValue: nativeEnv.value,
}))

describeOrSkip('cloud-run SSI', () => {
  const project = process.env.GCP_PROJECT_ID!
  const region = process.env.GCP_REGION!

  it.concurrent.each(SSI_CASES)(
    'injects the $language tracer',
    async ({language, image, tracerRepository, envName, envValue}) => {
      const serviceName = `one-e2e-ci-cr-ssi-${language}-${crypto.randomBytes(4).toString('hex')}`

      try {
        const deployResult = await execPromiseWithRetries(
          `gcloud run deploy "${serviceName}"` +
            ` --project "${project}"` +
            ` --region "${region}"` +
            ` --platform managed` +
            ` --image "${image}"` +
            ` --allow-unauthenticated` +
            ` --min-instances 0` +
            ` --max-instances 1` +
            ` --quiet` +
            ` --format=none` +
            ` --labels one_e2e_created=${Math.floor(Date.now() / 1000)}`
        )
        expect(deployResult).toEqual(expect.objectContaining({exitCode: 0}))

        const instrumentResult = await execPromiseWithRetries(
          `${DATADOG_CI_COMMAND} cloud-run instrument` +
            ` --project "${project}"` +
            ` --region "${region}"` +
            ` --service "${serviceName}"` +
            ` --tracing inject` +
            ` --language "${language}"` +
            ` --no-source-code-integration`,
          {DD_API_KEY: process.env.DATADOG_API_KEY}
        )
        expect(instrumentResult).toEqual(expect.objectContaining({exitCode: 0}))

        verifySsiInstrumented(serviceName, project, region, {
          appImage: image,
          tracerRepository,
          envName,
          envValue,
        })

        const urlResult = await execPromise(
          `gcloud run services describe "${serviceName}"` +
            ` --project "${project}"` +
            ` --region "${region}"` +
            ` --format="value(status.url)"`
        )
        expect(urlResult.exitCode).toBe(0)

        await triggerTraffic(urlResult.stdout.trim())
        await checkTelemetryFlowing({serviceName}, {checkLogs: false})
      } finally {
        const deleteResult = await execPromise(
          `gcloud run services delete "${serviceName}"` +
            ` --project "${project}"` +
            ` --region "${region}"` +
            ` --platform managed` +
            ` --quiet` +
            ` --format=none`
        )
        if (deleteResult.exitCode !== 0) {
          console.error(`Failed to delete Cloud Run service "${serviceName}": ${deleteResult.stderr}`)
        }
      }
    },
    600_000
  )

  it('detects and injects the Node.js tracer', async () => {
    const serviceName = `one-e2e-ci-cr-ssi-multi-nodejs-${crypto.randomBytes(4).toString('hex')}`
    const {image} = SSI_CASES.find(({language}) => language === 'nodejs')!

    try {
      const deployResult = await execPromiseWithRetries(
        `gcloud run deploy "${serviceName}"` +
          ` --project "${project}"` +
          ` --region "${region}"` +
          ` --platform managed` +
          ` --image "${image}"` +
          ` --allow-unauthenticated` +
          ` --min-instances 0` +
          ` --max-instances 1` +
          ` --quiet` +
          ` --format=none` +
          ` --labels one_e2e_created=${Math.floor(Date.now() / 1000)}`
      )
      expect(deployResult).toEqual(expect.objectContaining({exitCode: 0}))

      const instrumentResult = await execPromiseWithRetries(
        `${DATADOG_CI_COMMAND} cloud-run instrument` +
          ` --project "${project}"` +
          ` --region "${region}"` +
          ` --service "${serviceName}"` +
          ` --tracing inject` +
          ` --no-source-code-integration`,
        {DD_API_KEY: process.env.DATADOG_API_KEY}
      )
      expect(instrumentResult).toEqual(expect.objectContaining({exitCode: 0}))

      verifyMultiLanguageSsiInstrumented(serviceName, project, region, {appImage: image})

      const urlResult = await execPromise(
        `gcloud run services describe "${serviceName}"` +
          ` --project "${project}"` +
          ` --region "${region}"` +
          ` --format="value(status.url)"`
      )
      expect(urlResult.exitCode).toBe(0)

      await triggerTraffic(urlResult.stdout.trim())
      await checkTelemetryFlowing({serviceName}, {checkLogs: false})
    } finally {
      const deleteResult = await execPromise(
        `gcloud run services delete "${serviceName}"` +
          ` --project "${project}"` +
          ` --region "${region}"` +
          ` --platform managed` +
          ` --quiet` +
          ` --format=none`
      )
      if (deleteResult.exitCode !== 0) {
        console.error(`Failed to delete Cloud Run service "${serviceName}": ${deleteResult.stderr}`)
      }
    }
  }, 600_000)
})
