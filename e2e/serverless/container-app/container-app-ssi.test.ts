import crypto from 'node:crypto'

import {DATADOG_CI_COMMAND, execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {getContainerAppUrl, verifySsiInstrumented, verifyUninstrumented} from './container-app-verifier'

const NODE_APPLICATION_IMAGE =
  'us-central1-docker.pkg.dev/datadog-serverless-gcp-dev/e2e-workloads/node-ssi@sha256:5943fc61fc30fd77fd847819b37b2cf32dbc394c107116621610bd4b13099ce2'

const describeOrSkip =
  process.env.SKIP_CONTAINER_APP_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

describeOrSkip('container-app automatic APM instrumentation', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const runId = crypto.randomBytes(4).toString('hex')
  const appName = `one-e2e-capp-ssi-${runId}`
  const instrumentCommand =
    `${DATADOG_CI_COMMAND} container-app instrument` +
    ` -s "${subscriptionId}"` +
    ` -g "${resourceGroup}"` +
    ` -n "${appName}"` +
    ` --service "${appName}"` +
    ` --env e2e` +
    ` --version "${runId}"` +
    ` --extra-tags "one_e2e_run_id:${runId}"` +
    ` --tracing inject` +
    ` --language nodejs` +
    ` --no-source-code-integration`

  it('injects, retries, traces, and removes the Node.js tracer', async () => {
    let lifecycleError: Error | undefined
    let cleanupError: Error | undefined
    try {
      const create = await execPromiseWithRetries(
        `az containerapp create` +
          ` --name "${appName}"` +
          ` --resource-group "${resourceGroup}"` +
          ` --environment "${process.env.AZURE_CONTAINER_APP_ENV}"` +
          ` --image "${NODE_APPLICATION_IMAGE}"` +
          ` --cpu 0.25 --memory 0.5Gi` +
          ` --min-replicas 0 --max-replicas 1` +
          ` --ingress external --target-port 8080` +
          ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
          ` --output none`
      )
      if (create.exitCode !== 0) {
        throw new Error(`Failed to create container app (exit code ${create.exitCode}): ${create.stderr}`)
      }

      const instrument = await execPromiseWithRetries(instrumentCommand, {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      })
      expect(instrument.exitCode).toBe(0)
      verifySsiInstrumented(appName, resourceGroup, subscriptionId, runId, NODE_APPLICATION_IMAGE)

      const appUrl = getContainerAppUrl(appName, resourceGroup, subscriptionId)
      await Promise.all([
        triggerTraffic(appUrl, {attempts: 20, requiredSuccesses: 10, intervalSeconds: 10}),
        checkTelemetryFlowing(
          {
            serviceName: appName,
            env: 'e2e',
            version: runId,
            tags: [`one_e2e_run_id:${runId}`],
          },
          {checkLogs: false}
        ),
      ])

      const retry = await execPromiseWithRetries(instrumentCommand, {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      })
      expect(retry.exitCode).toBe(0)
      verifySsiInstrumented(appName, resourceGroup, subscriptionId, runId, NODE_APPLICATION_IMAGE)

      const uninstrument = await execPromiseWithRetries(
        `${DATADOG_CI_COMMAND} container-app uninstrument` +
          ` -s "${subscriptionId}"` +
          ` -g "${resourceGroup}"` +
          ` -n "${appName}"`,
        {DD_API_KEY: process.env.DATADOG_API_KEY}
      )
      expect(uninstrument.exitCode).toBe(0)
      verifyUninstrumented(appName, resourceGroup, subscriptionId)
    } catch (error) {
      lifecycleError = error instanceof Error ? error : new Error(String(error))
    } finally {
      const cleanup = await execPromiseWithRetries(
        `az containerapp delete --name "${appName}" --resource-group "${resourceGroup}" --yes --output none`
      )
      if (cleanup.exitCode !== 0) {
        cleanupError = new Error(`Failed to delete container app (exit code ${cleanup.exitCode}): ${cleanup.stderr}`)
      }
    }

    if (lifecycleError && cleanupError) {
      throw new Error(`${String(lifecycleError)}\n${cleanupError.message}`)
    }
    if (cleanupError) {
      throw cleanupError
    }
    if (lifecycleError) {
      throw lifecycleError
    }
  }, 1_200_000)
})
