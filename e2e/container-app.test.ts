import crypto from 'node:crypto'

import {getContainerAppUrl, verifyInstrumented, verifyUninstrumented} from './helpers/container-app-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'
import {checkTelemetryFlowing} from './helpers/telemetry-checker'
import {triggerTraffic} from './helpers/traffic'

const describeOrSkip =
  process.env.SKIP_CONTAINER_APP_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

describeOrSkip('container-app', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const appImage = process.env.AZURE_CONTAINER_APP_IMAGE_E2E!
  const runId = crypto.randomBytes(4).toString('hex')
  const appName = `one-e2e-ci-capp-${runId}`

  beforeAll(async () => {
    const result = await execPromiseWithRetries(
      `az containerapp create` +
        ` --name "${appName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --environment "${process.env.AZURE_CONTAINER_APP_ENV}"` +
        ` --image "${appImage}"` +
        ` --cpu 0.25 --memory 0.5Gi` +
        ` --min-replicas 0 --max-replicas 1` +
        ` --ingress external --target-port 8080` +
        ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create container app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  }, 600_000)

  afterAll(async () => {
    try {
      await execPromise(
        `az containerapp delete --name "${appName}" --resource-group "${resourceGroup}" --yes --output none`
      )
    } catch (error) {
      console.error('Failed to delete ephemeral container app:', error)
    }
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} container-app instrument` +
        ` -s "${subscriptionId}"` +
        ` -g "${resourceGroup}"` +
        ` -n "${appName}"` +
        ` --service "${appName}"` +
        ` --env e2e` +
        ` --version "${runId}"` +
        ` --extra-tags "one_e2e_run_id:${runId}"` +
        ` --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyInstrumented(appName, resourceGroup, subscriptionId, runId)
  }, 600_000)

  it('telemetry flows', async () => {
    const appUrl = getContainerAppUrl(appName, resourceGroup, subscriptionId)
    await triggerTraffic(appUrl)

    await checkTelemetryFlowing({
      serviceName: appName,
      env: 'e2e',
      version: runId,
      tags: [`one_e2e_run_id:${runId}`],
    })
  }, 600_000)

  it('instrument is idempotent', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} container-app instrument` +
        ` -s "${subscriptionId}"` +
        ` -g "${resourceGroup}"` +
        ` -n "${appName}"` +
        ` --service "${appName}"` +
        ` --env e2e` +
        ` --version "${runId}"` +
        ` --extra-tags "one_e2e_run_id:${runId}"` +
        ` --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toEqual(
      expect.stringMatching(/already exists with correct configuration|No changes detected/)
    )

    verifyInstrumented(appName, resourceGroup, subscriptionId, runId)
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} container-app uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${appName}"`,
      {
        DD_API_KEY: process.env.DATADOG_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyUninstrumented(appName, resourceGroup, subscriptionId)
  }, 600_000)
})
