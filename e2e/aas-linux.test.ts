import crypto from 'node:crypto'

import {verifyLinuxInstrumented, verifyLinuxUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'
import {checkTelemetryFlowing} from './helpers/telemetry-checker'
import {triggerTraffic} from './helpers/traffic'

const describeOrSkip =
  process.env.SKIP_AAS_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

// Pre-built Node.js app with dd-trace + winston, node_modules included
const NODE_SIDECAR_APP_URL = 'https://selfmonitoringprod.blob.core.windows.net/code/node-sidecar.zip'

describeOrSkip('aas (Linux)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const runId = crypto.randomBytes(4).toString('hex')
  const linuxAppName = `one-e2e-ci-aas-linux-${runId}`
  const linuxPlan = process.env.AZURE_AAS_LINUX_PLAN!

  // Tie telemetry to this run via service/env/version/run-id so the checker asserts
  // identity, not mere existence.
  const instrumentCommand =
    `${DATADOG_CI_COMMAND} aas instrument` +
    ` -s "${subscriptionId}"` +
    ` -g "${resourceGroup}"` +
    ` -n "${linuxAppName}"` +
    ` --service "${linuxAppName}"` +
    ` --env e2e` +
    ` --version "${runId}"` +
    ` --extra-tags "one_e2e_run_id:${runId}"` +
    // Enable instance log collection so the sidecar forwards the app's stdout logs, not just traces.
    ` --instance-logging` +
    ` --no-source-code-integration`

  beforeAll(async () => {
    const createResult = await execPromiseWithRetries(
      `az webapp create` +
        ` --name "${linuxAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${linuxPlan}"` +
        ` --runtime "NODE:22-lts"` +
        ` --https-only true` +
        ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
        ` --output none`
    )
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create Linux web app (exit code ${createResult.exitCode}): ${createResult.stderr}`)
    }

    // WEBSITE_RUN_FROM_PACKAGE mounts the zip as wwwroot via ARM (no Kudu/SCM permissions needed)
    const packageResult = await execPromise(
      `az webapp config appsettings set --name "${linuxAppName}" --resource-group "${resourceGroup}" --settings WEBSITE_RUN_FROM_PACKAGE="${NODE_SIDECAR_APP_URL}" --output none`
    )
    if (packageResult.exitCode !== 0) {
      throw new Error(`Failed to configure app package (exit code ${packageResult.exitCode}): ${packageResult.stderr}`)
    }
  }, 900_000)

  afterAll(async () => {
    try {
      await execPromise(
        `az webapp delete --name "${linuxAppName}" --resource-group "${resourceGroup}" --keep-empty-plan --output none`
      )
    } catch (error) {
      console.error('Failed to delete ephemeral Linux web app:', error)
    }
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, {
      DD_API_KEY: process.env.DATADOG_API_KEY,
    })
    expect(result.exitCode).toBe(0)

    verifyLinuxInstrumented(linuxAppName, resourceGroup, subscriptionId)
  })

  it('telemetry flows', async () => {
    const hostnameResult = await execPromise(
      `az webapp show --name "${linuxAppName}" --resource-group "${resourceGroup}" --query "defaultHostName" --output tsv`
    )
    const appUrl = `https://${hostnameResult.stdout.trim()}`
    // Drive sustained traffic: the sidecar's trace/log pipeline needs a beat to warm up after a
    // cold start, so a few early requests aren't enough to reliably land telemetry. Keep hitting
    // the app so spans and logs flow once it's fully ready.
    await triggerTraffic(appUrl, {attempts: 20, requiredSuccesses: 10})

    await checkTelemetryFlowing({
      serviceName: linuxAppName,
      env: 'e2e',
      version: runId,
      tags: [`one_e2e_run_id:${runId}`],
    })
  }, 600_000)

  it('instrument is idempotent', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, {
      DD_API_KEY: process.env.DATADOG_API_KEY,
    })
    expect(result.exitCode).toBe(0)

    // Re-instrumenting must not duplicate config -- the sidecar and settings stay singular.
    verifyLinuxInstrumented(linuxAppName, resourceGroup, subscriptionId)
  })

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${linuxAppName}"`,
      {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyLinuxUninstrumented(linuxAppName, resourceGroup, subscriptionId)
  })
})
