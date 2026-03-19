import {execSync} from './exec'

interface ContainerApp {
  properties: {
    template: {
      containers: {
        name: string
        image: string
        env?: {name: string; value?: string}[]
        volumeMounts?: {volumeName: string; mountPath?: string}[]
      }[]
      volumes?: {name: string; storageType: string}[]
    }
    configuration: {
      secrets?: {name: string}[]
    }
  }
  tags?: Record<string, string>
}

const getContainerApp = (appName: string, resourceGroup: string, subscriptionId: string): ContainerApp => {
  const output = execSync(
    `az containerapp show --subscription "${subscriptionId}" --resource-group "${resourceGroup}" --name "${appName}" --output json`
  )

  return JSON.parse(output)
}

export const verifyInstrumented = (appName: string, resourceGroup: string, subscriptionId: string): void => {
  console.log(`Fetching container app "${appName}"...`)
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  console.log('\nVerifying instrumented state:\n')

  const template = app.properties.template
  const config = app.properties.configuration
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  expect(sidecar).toBeDefined()
  expect(sidecar!.image).toEqual(expect.stringContaining('datadog/serverless-init'))

  const volume = volumes.find((v) => v.name === 'shared-volume')
  expect(volume).toBeDefined()
  expect(volume!.storageType).toBe('EmptyDir')

  const appContainers = containers.filter((c) => c.name !== 'datadog-sidecar')
  for (const container of appContainers) {
    const mounts = container.volumeMounts || []
    const mount = mounts.find((m) => m.volumeName === 'shared-volume')
    expect(mount).toBeDefined()
  }

  const requiredEnvVars = ['DD_TRACE_ENABLED', 'DD_LOGS_INJECTION', 'DD_HEALTH_PORT']
  for (const container of appContainers) {
    const env = container.env || []
    const envNames = env.map((e) => e.name)
    for (const varName of requiredEnvVars) {
      expect(envNames).toContain(varName)
    }
  }

  const apiKeySecret = secrets.find((s) => s.name === 'dd-api-key')
  expect(apiKeySecret).toBeDefined()

  expect(Object.keys(tags)).toContain('dd_sls_ci')

  console.log('\nAll instrumented checks passed.')
}

export const verifyUninstrumented = (appName: string, resourceGroup: string, subscriptionId: string): void => {
  console.log(`Fetching container app "${appName}"...`)
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  console.log('\nVerifying uninstrumented state:\n')

  const template = app.properties.template
  const config = app.properties.configuration
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  expect(sidecar).toBeUndefined()

  const volume = volumes.find((v) => v.name === 'shared-volume')
  expect(volume).toBeUndefined()

  for (const container of containers) {
    const env = container.env || []
    const ddVars = env.filter((e) => e.name.startsWith('DD_'))
    expect(ddVars).toHaveLength(0)
  }

  const apiKeySecret = secrets.find((s) => s.name === 'dd-api-key')
  expect(apiKeySecret).toBeUndefined()

  expect(Object.keys(tags)).not.toContain('dd_sls_ci')

  console.log('\nAll uninstrumented checks passed.')
}
