import crypto from 'node:crypto'

import {checkTelemetryFlowing} from './helpers/aas-telemetry-checker'
import {verifyLinuxInstrumented, verifyLinuxUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

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
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas instrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${linuxAppName}" --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyLinuxInstrumented(linuxAppName, resourceGroup, subscriptionId)
  })

  it('telemetry flows', async () => {
    const hostnameResult = await execPromise(
      `az webapp show --name "${linuxAppName}" --resource-group "${resourceGroup}" --query "defaultHostName" --output tsv`
    )
    const appUrl = `https://${hostnameResult.stdout.trim()}`
    await fetch(appUrl)
    await checkTelemetryFlowing(linuxAppName)
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${linuxAppName}"`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyLinuxUninstrumented(linuxAppName, resourceGroup, subscriptionId)
  })
})
