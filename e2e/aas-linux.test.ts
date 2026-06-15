import crypto from 'node:crypto'

import {verifyLinuxInstrumented, verifyLinuxUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

const describeOrSkip =
  process.env.SKIP_AAS_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

describeOrSkip('aas (Linux)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const runId = crypto.randomBytes(4).toString('hex')
  const linuxAppName = `dd-e2e-ci-aas-linux-${runId}`
  const linuxPlan = process.env.AZURE_AAS_LINUX_PLAN!

  beforeAll(async () => {
    const result = await execPromiseWithRetries(
      `az webapp create` +
        ` --name "${linuxAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${linuxPlan}"` +
        ` --runtime "NODE:22-lts"` +
        ` --https-only true` +
        ` --tags dd_e2e=true dd_e2e_tool=ci-aas-linux dd_e2e_run=${runId} dd_e2e_created=${Math.floor(Date.now() / 1000)}` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Linux web app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  }, 600_000)

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
