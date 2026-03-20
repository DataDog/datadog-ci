import {ContainerAppsAPIClient} from '@azure/arm-appcontainers'
import {WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient} from '@azure/arm-resources'
import {app, InvocationContext, Timer} from '@azure/functions'
import {DefaultAzureCredential} from '@azure/identity'

const E2E_PREFIXES = ['dd-ci-capp-', 'dd-ci-aas-linux-', 'dd-ci-aas-win-']
const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

const isE2EResource = (name: string): boolean => {
  return E2E_PREFIXES.some((prefix) => name.startsWith(prefix))
}

const cleanupResources = async (_timer: Timer, context: InvocationContext): Promise<void> => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!
  const credential = new DefaultAzureCredential()
  const now = Date.now()

  // Use the generic ARM client to list resources with creation times
  const resourceClient = new ResourceManagementClient(credential, subscriptionId)

  const staleContainerApps: string[] = []
  const staleWebApps: string[] = []

  for await (const resource of resourceClient.resources.listByResourceGroup(resourceGroup, {
    expand: 'createdTime',
  })) {
    const name = resource.name
    if (!name || !isE2EResource(name)) {
      continue
    }

    const createdTime = resource.createdTime
    if (!createdTime) {
      context.log(`Skipping "${name}": no creation timestamp`)
      continue
    }

    const ageMs = now - createdTime.getTime()
    if (ageMs <= MAX_AGE_MS) {
      continue
    }

    const ageMin = Math.round(ageMs / 60_000)

    if (resource.type === 'Microsoft.App/containerApps') {
      context.log(`Stale container app: "${name}" (age: ${ageMin}m)`)
      staleContainerApps.push(name)
    } else if (resource.type === 'Microsoft.Web/sites') {
      context.log(`Stale web app: "${name}" (age: ${ageMin}m)`)
      staleWebApps.push(name)
    }
  }

  if (staleContainerApps.length > 0) {
    const containerClient = new ContainerAppsAPIClient(credential, subscriptionId)
    for (const name of staleContainerApps) {
      try {
        await containerClient.containerApps.beginDeleteAndWait(resourceGroup, name)
        context.log(`Deleted container app "${name}"`)
      } catch (err) {
        context.error(`Failed to delete container app "${name}":`, err)
      }
    }
  }

  if (staleWebApps.length > 0) {
    const webClient = new WebSiteManagementClient(credential, subscriptionId)
    for (const name of staleWebApps) {
      try {
        // deleteEmptyServerFarm: false to preserve the shared App Service Plans
        await webClient.webApps.delete(resourceGroup, name, {deleteEmptyServerFarm: false})
        context.log(`Deleted web app "${name}"`)
      } catch (err) {
        context.error(`Failed to delete web app "${name}":`, err)
      }
    }
  }

  context.log(
    `Cleanup complete. Deleted ${staleContainerApps.length} container app(s) and ${staleWebApps.length} web app(s).`
  )
}

app.timer('cleanupResources', {
  schedule: '0 0 * * * *',
  handler: cleanupResources,
})
