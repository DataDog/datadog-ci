import crypto from 'node:crypto'

import {verifyWindowsInstrumented, verifyWindowsUninstrumented} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

const describeOrSkip = process.env.SKIP_AAS_TESTS === 'true' ? describe.skip : describe

describeOrSkip('aas (Windows)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const windowsAppName = `dd-ci-aas-win-${crypto.randomBytes(4).toString('hex')}`
  const windowsPlan = process.env.AZURE_AAS_WINDOWS_PLAN!

  beforeAll(async () => {
    // Stagger parallel matrix runs to avoid Azure extension install conflicts
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 60_000))

    const result = await execPromiseWithRetries(
      `az webapp create` +
        ` --name "${windowsAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${windowsPlan}"` +
        ` --runtime "NODE:22LTS"` +
        ` --https-only true` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Windows web app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  }, 600_000)

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
