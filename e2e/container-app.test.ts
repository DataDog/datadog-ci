import {verifyInstrumented, verifyUninstrumented} from './helpers/container-app-verifier'
import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

const describeOrSkip = process.env.SKIP_CONTAINER_APP_TESTS === 'true' ? describe.skip : describe

describeOrSkip('container-app', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const appName = process.env.AZURE_CONTAINER_APP_NAME!

  beforeAll(async () => {
    const result = await execPromise(
      `az containerapp create` +
        ` --name "${appName}"` +
        ` --resource-group "${resourceGroup}"` +
        ` --environment "${process.env.AZURE_CONTAINER_APP_ENV}"` +
        ` --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest` +
        ` --cpu 0.25 --memory 0.5Gi` +
        ` --min-replicas 0 --max-replicas 1` +
        ` --ingress external --target-port 80` +
        ` --output none`
    )
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create container app (exit code ${result.exitCode}): ${result.stderr}`)
    }
  })

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
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} container-app instrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${appName}" --no-source-code-integration`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyInstrumented(appName, resourceGroup, subscriptionId)
  })

  it('uninstrument and verify', async () => {
    const result = await execPromise(
      `${DATADOG_CI_COMMAND} container-app uninstrument -s "${subscriptionId}" -g "${resourceGroup}" -n "${appName}"`,
      {
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expect(result.exitCode).toBe(0)

    verifyUninstrumented(appName, resourceGroup, subscriptionId)
  })
})
