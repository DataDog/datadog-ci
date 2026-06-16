import {execSync} from './exec'

interface ContainerApp {
  properties: {
    template: {
      containers: {
        name: string
        image: string
        env?: {name: string; value?: string; secretRef?: string}[]
        volumeMounts?: {volumeName: string; mountPath?: string}[]
      }[]
      volumes?: {name: string; storageType: string}[]
    }
    configuration: {
      ingress?: {
        fqdn?: string
      }
      secrets?: {name: string}[]
    }
  }
  tags?: Record<string, string>
}

const SIDECAR_NAME = 'datadog-sidecar'
const SHARED_VOLUME_NAME = 'shared-volume'
const DD_API_KEY_SECRET_NAME = 'dd-api-key'
const EXPECTED_ENV = 'e2e'
const REQUIRED_ENV_VARS = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_SERVICE',
  'DD_ENV',
  'DD_VERSION',
  'DD_TRACE_ENABLED',
  'DD_LOGS_INJECTION',
  'DD_HEALTH_PORT',
  'DD_TAGS',
  'DD_APM_ENABLED',
]
const DATADOG_TAGS = ['service', 'env', 'version', 'dd_sls_ci']

const getContainerApp = (appName: string, resourceGroup: string, subscriptionId: string): ContainerApp => {
  const output = execSync(
    `az containerapp show --subscription "${subscriptionId}" --resource-group "${resourceGroup}" --name "${appName}" --output json`
  )

  return JSON.parse(output)
}

const envByName = (
  container: ContainerApp['properties']['template']['containers'][number]
): Record<string, {name: string; value?: string; secretRef?: string}> => {
  return Object.fromEntries((container.env || []).map((env) => [env.name, env]))
}

export const getContainerAppUrl = (appName: string, resourceGroup: string, subscriptionId: string): string => {
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  const fqdn = app.properties.configuration.ingress?.fqdn
  expect(fqdn).toBeDefined()

  return `https://${fqdn}`
}

export const verifyInstrumented = (
  appName: string,
  resourceGroup: string,
  subscriptionId: string,
  runId: string
): void => {
  console.log(`Fetching container app "${appName}"...`)
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  console.log('\nVerifying instrumented state:\n')

  const template = app.properties.template
  const config = app.properties.configuration
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  const sidecar = containers.find((c) => c.name === SIDECAR_NAME)
  expect(sidecar).toBeDefined()
  expect(sidecar!.image).toEqual(expect.stringContaining('datadog/serverless-init'))

  const volume = volumes.find((v) => v.name === SHARED_VOLUME_NAME)
  expect(volume).toBeDefined()
  expect(volume!.storageType).toBe('EmptyDir')

  const appContainers = containers.filter((c) => c.name !== SIDECAR_NAME)
  expect(appContainers.length).toBeGreaterThan(0)
  for (const container of appContainers) {
    const mounts = container.volumeMounts || []
    const mount = mounts.find((m) => m.volumeName === SHARED_VOLUME_NAME)
    expect(mount).toBeDefined()
  }

  const sidecarMounts = sidecar!.volumeMounts || []
  expect(sidecarMounts.some((m) => m.volumeName === SHARED_VOLUME_NAME)).toBe(true)

  for (const container of containers) {
    const env = envByName(container)
    for (const varName of REQUIRED_ENV_VARS) {
      expect(env[varName]).toBeDefined()
    }
    expect(env.DD_API_KEY.secretRef).toBe(DD_API_KEY_SECRET_NAME)
    expect(env.DD_SERVICE.value).toBe(appName)
    expect(env.DD_ENV.value).toBe(EXPECTED_ENV)
    expect(env.DD_VERSION.value).toBe(runId)
    expect(env.DD_TRACE_ENABLED.value).toBe('true')
    expect(env.DD_LOGS_INJECTION.value).toBe('true')
    expect(env.DD_HEALTH_PORT.value).toBe('5555')
    expect(env.DD_TAGS.value).toContain(`one_e2e_run_id:${runId}`)
    expect(env.DD_APM_ENABLED.value).toBe('true')
  }

  const apiKeySecret = secrets.find((s) => s.name === DD_API_KEY_SECRET_NAME)
  expect(apiKeySecret).toBeDefined()

  expect(tags.service).toBe(appName)
  expect(tags.env).toBe(EXPECTED_ENV)
  expect(tags.version).toBe(runId)
  expect(tags.dd_sls_ci).toBeDefined()
  expect(tags.one_e2e_created).toBeDefined()

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

  const sidecar = containers.find((c) => c.name === SIDECAR_NAME)
  expect(sidecar).toBeUndefined()

  const volume = volumes.find((v) => v.name === SHARED_VOLUME_NAME)
  expect(volume).toBeUndefined()

  for (const container of containers) {
    const env = container.env || []
    const ddVars = env.filter((e) => e.name.startsWith('DD_'))
    expect(ddVars).toHaveLength(0)
  }

  const apiKeySecret = secrets.find((s) => s.name === DD_API_KEY_SECRET_NAME)
  expect(apiKeySecret).toBeUndefined()

  for (const tag of DATADOG_TAGS) {
    expect(Object.keys(tags)).not.toContain(tag)
  }
  expect(tags.one_e2e_created).toBeDefined()

  console.log('\nAll uninstrumented checks passed.')
}
