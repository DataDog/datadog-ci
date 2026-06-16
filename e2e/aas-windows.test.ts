import crypto from 'node:crypto'

import {checkTelemetryFlowing} from './helpers/aas-telemetry-checker'
import {verifyWindowsInstrumented, verifyWindowsUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

const describeOrSkip =
  process.env.SKIP_AAS_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

// Pre-built Node.js app with dd-trace + winston, node_modules included
const NODE_EXTENSION_APP_URL = 'https://selfmonitoringprod.blob.core.windows.net/code/node-extension.zip'

describeOrSkip('aas (Windows)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const runId = crypto.randomBytes(4).toString('hex')
  const windowsAppName = `one-e2e-ci-aas-win-${runId}`
  const windowsPlan = process.env.AZURE_AAS_WINDOWS_PLAN!

  beforeAll(async () => {
    // Stagger parallel matrix runs to avoid Azure extension install conflicts
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 60_000))

    const createResult = await execPromiseWithRetries(
      `az webapp create` +
        ` --name "${windowsAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${windowsPlan}"` +
        ` --runtime "NODE:22LTS"` +
        ` --https-only true` +
        ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
        ` --output none`
    )
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create Windows web app (exit code ${createResult.exitCode}): ${createResult.stderr}`)
    }

    const zipPath = `/tmp/aas-node-extension-${runId}.zip`
    await execPromise(`curl -fsSL "${NODE_EXTENSION_APP_URL}" -o "${zipPath}"`)
    const deployResult = await execPromise(
      `az webapp deploy --name "${windowsAppName}" --resource-group "${resourceGroup}" --src-path "${zipPath}" --type zip --output none`
    )
    if (deployResult.stderr) {
      console.log(`App deploy output: ${deployResult.stderr}`)
    }
  }, 900_000)

  afterAll(async () => {
    try {
      await execPromise(
        `az webapp delete --name "${windowsAppName}" --resource-group "${resourceGroup}" --keep-empty-plan --output none`
      )
    } catch (error) {
      console.error('Failed to delete ephemeral Windows web app:', error)
    }
  })

  // Windows site extension installs are slow (~4min) and may need retries
  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas instrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${windowsAppName}" --windows-runtime node --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      },
      {maxAttempts: 5, delaySeconds: 30}
    )
    expect(result.exitCode).toBe(0)

    verifyWindowsInstrumented(windowsAppName, resourceGroup, subscriptionId)
  }, 900_000)

  it('telemetry flows', async () => {
    const hostnameResult = await execPromise(
      `az webapp show --name "${windowsAppName}" --resource-group "${resourceGroup}" --query "defaultHostName" --output tsv`
    )
    const appUrl = `https://${hostnameResult.stdout.trim()}`
    await fetch(appUrl)
    await checkTelemetryFlowing(windowsAppName)
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${windowsAppName}"`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyWindowsUninstrumented(windowsAppName, resourceGroup, subscriptionId)
  }, 600_000)
})
