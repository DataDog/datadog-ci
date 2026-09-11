import crypto from 'node:crypto'
import {promises as fs} from 'node:fs'
import os from 'node:os'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {verifyLinuxInstrumented, verifyLinuxUninstrumented} from './aas-verifier'

const describeOrSkip =
  process.env.SKIP_AAS_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

const APP_JS = `const http = require('http')

http.createServer((_req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'})
  res.end('Hello from the zero-dependency AAS SSI e2e app\\n')
}).listen(process.env.PORT || 3000)
`

// Code-based SSI coverage: the app contains no Datadog package or configuration.
describeOrSkip('aas (Linux code-based SSI)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const runId = crypto.randomBytes(4).toString('hex')
  const appName = `one-e2e-ci-aas-linux-ssi-${runId}`
  const plan = process.env.AZURE_AAS_LINUX_PLAN!
  const instrumentCommand =
    `${DATADOG_CI_COMMAND} aas instrument` +
    ` -s "${subscriptionId}" -g "${resourceGroup}" -n "${appName}"` +
    ` --service "${appName}" --env e2e --version "${runId}"` +
    ` --extra-tags "one_e2e_run_id:${runId}" --instance-logging` +
    ` --apm-enabled --no-source-code-integration`

  beforeAll(async () => {
    const createResult = await execPromiseWithRetries(
      `az webapp create --name "${appName}" --resource-group "${resourceGroup}" --plan "${plan}"` +
        ` --runtime "NODE:22-lts" --https-only true --tags one_e2e_created=${Math.floor(Date.now() / 1000)} --output none`
    )
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create Linux SSI web app (exit code ${createResult.exitCode}): ${createResult.stderr}`)
    }

    const appPath = `${os.tmpdir()}/${appName}-app.js`
    await fs.writeFile(appPath, APP_JS)
    const startupResult = await execPromise(
      `az webapp config set --name "${appName}" --resource-group "${resourceGroup}" --startup-file "node app.js" --output none`
    )
    if (startupResult.exitCode !== 0) {
      throw new Error(
        `Failed to configure SSI startup command (exit code ${startupResult.exitCode}): ${startupResult.stderr}`
      )
    }
    const deployResult = await execPromise(
      `az webapp deployment list-publishing-credentials --name "${appName}" --resource-group "${resourceGroup}" --output json`
    )
    if (deployResult.exitCode !== 0) {
      throw new Error(
        `Failed to get SSI app SCM credentials (exit code ${deployResult.exitCode}): ${deployResult.stderr}`
      )
    }
    const credentials = JSON.parse(deployResult.stdout)
    const scmUri = (credentials.properties ?? credentials).scmUri
    const tokenResult = await execPromise(
      'az account get-access-token --resource https://management.azure.com/ --query accessToken --output tsv'
    )
    if (tokenResult.exitCode !== 0) {
      throw new Error(`Failed to get Azure access token (exit code ${tokenResult.exitCode}): ${tokenResult.stderr}`)
    }
    const uploadResult = await execPromise(
      `curl --fail --silent --show-error --request PUT --header "Authorization: Bearer ${tokenResult.stdout.trim()}"` +
        ` --upload-file "${appPath}" "${scmUri.replace(/\/$/, '')}/api/vfs/site/wwwroot/app.js"`
    )
    if (uploadResult.exitCode !== 0) {
      throw new Error(`Failed to upload SSI app (exit code ${uploadResult.exitCode}): ${uploadResult.stderr}`)
    }
    const restartResult = await execPromise(
      `az webapp restart --name "${appName}" --resource-group "${resourceGroup}" --output none`
    )
    if (restartResult.exitCode !== 0) {
      throw new Error(`Failed to restart SSI app (exit code ${restartResult.exitCode}): ${restartResult.stderr}`)
    }
  }, 900_000)

  afterAll(async () => {
    await execPromise(
      `az webapp delete --name "${appName}" --resource-group "${resourceGroup}" --keep-empty-plan --output none`
    )
  })

  it('instruments code-based app and verifies staged tracer', async () => {
    const result = await execPromiseWithRetries(
      instrumentCommand,
      {DD_API_KEY: process.env.DATADOG_API_KEY},
      {maxAttempts: 12, delaySeconds: 15}
    )
    if (result.exitCode !== 0) {
      throw new Error(`SSI instrumentation failed:\n${result.stdout}\n${result.stderr}`)
    }
    verifyLinuxInstrumented(appName, resourceGroup, subscriptionId, true)
    // Staging the tracer via OneDeploy can take tens of minutes on a busy App Service plan
  }, 1_800_000)

  it('emits request telemetry without app tracer dependencies', async () => {
    const hostnameResult = await execPromise(
      `az webapp show --name "${appName}" --resource-group "${resourceGroup}" --query defaultHostName --output tsv`
    )
    await triggerTraffic(`https://${hostnameResult.stdout.trim()}`, {attempts: 20, requiredSuccesses: 10})
    await checkTelemetryFlowing(
      {
        serviceName: appName,
        env: 'e2e',
        version: runId,
        tags: [`one_e2e_run_id:${runId}`],
      },
      {checkLogs: false}
    )
  }, 600_000)

  it('uninstruments and removes the staged tracer', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${appName}"`,
      {DD_API_KEY: process.env.DATADOG_API_KEY}
    )
    expect(result.exitCode).toBe(0)
    verifyLinuxUninstrumented(appName, resourceGroup, subscriptionId, true)
  }, 900_000)
})
