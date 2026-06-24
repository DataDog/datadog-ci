import crypto from 'node:crypto'
import {promises as fs} from 'node:fs'
import os from 'node:os'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {verifyWindowsInstrumented, verifyWindowsUninstrumented} from './aas-verifier'

const describeOrSkip =
  process.env.SKIP_AAS_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

// A self-contained test app deployed to the Windows web app. It's a zero-dependency Node HTTP
// server (no node_modules, no build) -- the `aas instrument` site extension injects dd-trace, which
// auto-instruments the built-in `http` module, so requests produce spans without the app bundling
// anything. Owning the app here keeps the test self-contained instead of depending on an external
// prebuilt package.
const APP_JS = `const http = require('http')

const port = process.env.PORT || 3000
http
  .createServer((_req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'})
    res.end('Hello from the datadog-ci AAS Windows e2e app\\n')
  })
  .listen(port)
`

// On Windows, App Service serves Node behind IIS via iisnode, which needs a web.config to hand
// requests to the app -- without one IIS denies directory browsing and returns 403. (The Kudu build
// is supposed to generate it, but for `az webapp deploy` on Windows it does not do so reliably.)
// Route every request to app.js.
const WEB_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="iisnode" path="app.js" verb="*" modules="iisnode" />
    </handlers>
    <rewrite>
      <rules>
        <rule name="DynamicContent">
          <match url="/*" />
          <action type="Rewrite" url="app.js" />
        </rule>
      </rules>
    </rewrite>
    <httpErrors existingResponse="PassThrough" />
  </system.webServer>
</configuration>
`

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

    const settingsResult = await execPromise(
      `az webapp config appsettings set --name "${windowsAppName}" --resource-group "${resourceGroup}" --settings WEBSITE_NODE_DEFAULT_VERSION="~22" --output none`
    )
    if (settingsResult.exitCode !== 0) {
      throw new Error(
        `Failed to configure app settings (exit code ${settingsResult.exitCode}): ${settingsResult.stderr}`
      )
    }

    // Deploy app.js and web.config as individual files into wwwroot (`--type static`). No build or
    // package is involved -- the app is zero-dependency, so the files just need to land. Deploy them
    // sequentially (static deploys don't clean wwwroot, so both files accumulate). The retries cover
    // the 502 the SCM site returns while it is still cold on the first deploy.
    const appJsPath = `${os.tmpdir()}/${windowsAppName}-app.js`
    const webConfigPath = `${os.tmpdir()}/${windowsAppName}-web.config`
    await fs.writeFile(appJsPath, APP_JS)
    await fs.writeFile(webConfigPath, WEB_CONFIG)

    for (const [label, srcPath, targetPath] of [
      ['app.js', appJsPath, '/home/site/wwwroot/app.js'],
      ['web.config', webConfigPath, '/home/site/wwwroot/web.config'],
    ]) {
      const deployResult = await execPromiseWithRetries(
        `az webapp deploy --resource-group "${resourceGroup}" --name "${windowsAppName}" --src-path "${srcPath}" --type static --target-path "${targetPath}" --output none`,
        undefined,
        {maxAttempts: 5, delaySeconds: 20}
      )
      if (deployResult.exitCode !== 0) {
        throw new Error(`Failed to deploy ${label} (exit code ${deployResult.exitCode}): ${deployResult.stderr}`)
      }
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
        DD_API_KEY: process.env.DATADOG_API_KEY,
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
        DD_API_KEY: process.env.DATADOG_API_KEY,
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
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyWindowsUninstrumented(windowsAppName, resourceGroup, subscriptionId)
  }, 600_000)
})
