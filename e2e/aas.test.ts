import crypto from 'node:crypto'

import {
  verifyLinuxInstrumented,
  verifyLinuxUninstrumented,
  verifyWindowsInstrumented,
  verifyWindowsUninstrumented,
} from './helpers/aas-verifier'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'

const randomSuffix = () => crypto.randomBytes(4).toString('hex')

const describeOrSkip = process.env.SKIP_AAS_TESTS === 'true' ? describe.skip : describe

describeOrSkip('aas (Linux)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const linuxAppName = `dd-ci-aas-linux-${randomSuffix()}`
  const linuxPlan = process.env.AZURE_AAS_LINUX_PLAN!

  beforeAll(async () => {
    const result = await execPromise(
      `az webapp create` +
        ` --name "${linuxAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${linuxPlan}"` +
        ` --runtime "NODE:20-lts"` +
        ` --https-only true` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Linux web app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  })

  afterAll(async () => {
    try {
      await execPromise(
        `az webapp delete --name "${linuxAppName}" --resource-group "${resourceGroup}" --keep-empty-plan --output none`
      )
    } catch (error) {
      console.error('Failed to delete ephemeral Linux web app:', error)
    }
  })

  it('linux instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas instrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${linuxAppName}" --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyLinuxInstrumented(linuxAppName, resourceGroup, subscriptionId)
  })

  it('linux uninstrument and verify', async () => {
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

describeOrSkip('aas (Windows)', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const windowsAppName = `dd-ci-aas-win-${randomSuffix()}`
  const windowsPlan = process.env.AZURE_AAS_WINDOWS_PLAN!

  beforeAll(async () => {
    const result = await execPromise(
      `az webapp create` +
        ` --name "${windowsAppName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --plan "${windowsPlan}"` +
        ` --runtime "NODE:20LTS"` +
        ` --https-only true` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create Windows web app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  })

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
  it('windows instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} aas instrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${windowsAppName}" --windows-runtime node --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyWindowsInstrumented(windowsAppName, resourceGroup, subscriptionId)
  }, 900_000)

  it('windows uninstrument and verify', async () => {
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
