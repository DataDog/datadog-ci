import crypto from 'node:crypto'
import os from 'node:os'

import {verifyWindowsInstrumented, verifyWindowsUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'
import {checkTelemetryFlowing} from './helpers/telemetry-checker'
import {triggerTraffic} from './helpers/traffic'

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

  // Tie telemetry to this run via service/env/version/run-id so the checker asserts
  // identity, not mere existence.
  const instrumentCommand =
    `${DATADOG_CI_COMMAND} aas instrument` +
    ` -s "${subscriptionId}"` +
    ` -g "${resourceGroup}"` +
    ` -n "${windowsAppName}"` +
    ` --service "${windowsAppName}"` +
    ` --env e2e` +
    ` --version "${runId}"` +
    ` --extra-tags "one_e2e_run_id:${runId}"` +
    ` --windows-runtime node` +
    ` --no-source-code-integration`

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

    // On Windows, App Service serves Node behind IIS via iisnode, which needs a web.config to
    // route requests to the app. WEBSITE_RUN_FROM_PACKAGE mounts the package read-only and skips
    // the Oryx build that generates that web.config, so the app returns a 403. Deploy via zipdeploy
    // with SCM_DO_BUILD_DURING_DEPLOYMENT so Oryx builds and writes the web.config (same path prod
    // uses). Auth is the az-login AAD token -- basic-auth publishing is disabled by policy.
    const buildResult = await execPromise(
      `az webapp config appsettings set --name "${windowsAppName}" --resource-group "${resourceGroup}" --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true WEBSITE_NODE_DEFAULT_VERSION="~22" --output none`
    )
    if (buildResult.exitCode !== 0) {
      throw new Error(`Failed to configure build settings (exit code ${buildResult.exitCode}): ${buildResult.stderr}`)
    }

    const zipPath = `${os.tmpdir()}/${windowsAppName}.zip`
    const downloadResult = await execPromise(`curl -fsSL -o "${zipPath}" "${NODE_EXTENSION_APP_URL}"`)
    if (downloadResult.exitCode !== 0) {
      throw new Error(`Failed to download app package (exit code ${downloadResult.exitCode}): ${downloadResult.stderr}`)
    }

    // The SCM site can 502 on the first deploy while it is still cold; execPromiseWithRetries
    // retries on that gateway error.
    const deployResult = await execPromiseWithRetries(
      `az webapp deploy --resource-group "${resourceGroup}" --name "${windowsAppName}" --src-path "${zipPath}" --type zip --output none`,
      undefined,
      {maxAttempts: 5, delaySeconds: 20}
    )
    if (deployResult.exitCode !== 0) {
      throw new Error(`Failed to deploy app package (exit code ${deployResult.exitCode}): ${deployResult.stderr}`)
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
      instrumentCommand,
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
    // Drive sustained traffic: the extension's trace pipeline needs a beat to warm up after a cold
    // start, so a few early requests aren't enough to reliably land telemetry. Keep hitting the app
    // so spans flow once it's fully ready.
    await triggerTraffic(appUrl, {attempts: 20, requiredSuccesses: 10})

    // Windows App Service doesn't support Datadog log collection, so assert traces only.
    await checkTelemetryFlowing(
      {
        serviceName: windowsAppName,
        env: 'e2e',
        version: runId,
        tags: [`one_e2e_run_id:${runId}`],
      },
      {checkLogs: false}
    )
  }, 600_000)

  it('instrument is idempotent', async () => {
    const result = await execPromiseWithRetries(
      instrumentCommand,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      },
      {maxAttempts: 5, delaySeconds: 30}
    )
    expect(result.exitCode).toBe(0)

    // Re-instrumenting must not duplicate config -- the site extension and settings stay singular.
    verifyWindowsInstrumented(windowsAppName, resourceGroup, subscriptionId)
  }, 900_000)

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
