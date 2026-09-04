import crypto from 'node:crypto'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {verifySsiInstrumented} from './cloud-run-verifier'

const describeOrSkip =
  process.env.SKIP_CLOUD_RUN_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

const SSI_CASES = [
  {
    language: 'csharp',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/dotnet-ssi:latest',
    tracerRepository: 'dotnet',
    envName: 'CORECLR_PROFILER_PATH',
    envValue: '/datadog-lib/Datadog.Trace.ClrProfiler.Native.so',
  },
  {
    language: 'java',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/java-ssi:latest',
    tracerRepository: 'java',
    envName: 'JAVA_TOOL_OPTIONS',
    envValue: '-javaagent:/datadog-lib/dd-java-agent.jar',
  },
  {
    language: 'nodejs',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/node-ssi:latest',
    tracerRepository: 'js',
    envName: 'NODE_OPTIONS',
    envValue: '--require /datadog-lib/node_modules/dd-trace/init.js',
  },
  {
    language: 'php',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/php-ssi:latest',
    tracerRepository: 'php',
    envName: 'PHP_INI_SCAN_DIR',
    envValue: '/datadog-lib/linux-gnu/loader',
  },
  {
    language: 'python',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/python-ssi:latest',
    tracerRepository: 'python',
    envName: 'PYTHONPATH',
    envValue: '/datadog-lib',
  },
  {
    language: 'ruby',
    image: 'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/ruby-ssi:latest',
    tracerRepository: 'ruby',
    envName: 'RUBYOPT',
    envValue: '-r/datadog-lib/auto_inject',
  },
] as const

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
})
