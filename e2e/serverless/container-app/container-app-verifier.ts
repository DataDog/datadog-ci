import {execSync} from '../../helpers/exec'

interface ContainerApp {
  properties: {
    template: {
      initContainers?: {
        name: string
        image: string
        command?: string[]
        args?: string[]
        resources?: {cpu?: number; memory?: string}
        volumeMounts?: {volumeName: string; mountPath?: string}[]
      }[]
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
const TRACER_NAME = 'datadog-tracer'
const TRACER_MOUNT_PATH = '/datadog-lib'
const INJECTION_MODE_TAG = '_dd.injection.mode:serverless-single-lang'
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
const DATADOG_TAGS = ['service', 'env', 'version', 'dd_sls_ci', 'dd_sls_injection_mode']

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

const verifyDatadogEnv = (
  containers: ContainerApp['properties']['template']['containers'],
  appName: string,
  runId: string
): void => {
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

  verifyDatadogEnv(containers, appName, runId)

  const apiKeySecret = secrets.find((s) => s.name === DD_API_KEY_SECRET_NAME)
  expect(apiKeySecret).toBeDefined()

  expect(tags.service).toBe(appName)
  expect(tags.env).toBe(EXPECTED_ENV)
  expect(tags.version).toBe(runId)
  expect(tags.dd_sls_ci).toBeDefined()
  expect(tags.one_e2e_created).toBeDefined()

  console.log('\nAll instrumented checks passed.')
}

interface NativeEnvExpectation {
  name: string
  fragment: string
}

interface SsiExpectation {
  applicationImage: string
  tracerRepository: string
  nativeEnv: NativeEnvExpectation
  runId: string
}

export const verifySsiInstrumented = (
  appName: string,
  resourceGroup: string,
  subscriptionId: string,
  expectation: SsiExpectation
): void => {
  console.log(`Fetching container app "${appName}"...`)
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  const template = app.properties.template
  const containers = template.containers ?? []
  const initContainers = template.initContainers ?? []
  const volumes = template.volumes ?? []
  const tags = app.tags ?? {}

  const sidecar = containers.find(({name}) => name === SIDECAR_NAME)
  expect(sidecar).toBeDefined()
  const applicationContainers = containers.filter(({name}) => name !== SIDECAR_NAME)
  expect(applicationContainers).toHaveLength(1)
  const application = applicationContainers[0]
  expect(application.image).toBe(expectation.applicationImage)

  verifyDatadogEnv(containers, appName, expectation.runId)

  const tracerImage = `datadoghq.azurecr.io/dd-lib-${expectation.tracerRepository}-init:latest`
  const tracerContainers = initContainers.filter(({name}) => name === TRACER_NAME)
  expect(tracerContainers).toHaveLength(1)
  expect(tracerContainers[0]).toEqual(
    expect.objectContaining({
      image: tracerImage,
      command: ['/datadog-init/copy-lib.sh'],
      args: [TRACER_MOUNT_PATH],
      resources: expect.objectContaining({cpu: 0.25, memory: '0.5Gi'}),
      volumeMounts: [{volumeName: TRACER_NAME, mountPath: TRACER_MOUNT_PATH}],
    })
  )

  expect(volumes.filter(({name}) => name === TRACER_NAME)).toEqual([expect.objectContaining({storageType: 'EmptyDir'})])
  expect(
    containers
      .filter((container) => container.volumeMounts?.some(({volumeName}) => volumeName === TRACER_NAME))
      .map(({name}) => name)
  ).toEqual([application.name])
  expect(
    initContainers
      .filter((container) => container.volumeMounts?.some(({volumeName}) => volumeName === TRACER_NAME))
      .map(({name}) => name)
  ).toEqual([TRACER_NAME])
  expect(
    containers
      .filter((container) => container.volumeMounts?.some(({mountPath}) => mountPath === TRACER_MOUNT_PATH))
      .map(({name}) => name)
  ).toEqual([application.name])
  expect(
    initContainers
      .filter((container) => container.volumeMounts?.some(({mountPath}) => mountPath === TRACER_MOUNT_PATH))
      .map(({name}) => name)
  ).toEqual([TRACER_NAME])
  expect(application.volumeMounts?.filter(({volumeName}) => volumeName === TRACER_NAME)).toEqual([
    {volumeName: TRACER_NAME, mountPath: TRACER_MOUNT_PATH},
  ])
  expect(sidecar!.volumeMounts ?? []).not.toContainEqual(expect.objectContaining({volumeName: TRACER_NAME}))
  expect(sidecar!.volumeMounts ?? []).not.toContainEqual(expect.objectContaining({mountPath: TRACER_MOUNT_PATH}))
  expect(
    sidecar!.env?.some(
      ({name, value}) => name === expectation.nativeEnv.name && value?.includes(expectation.nativeEnv.fragment)
    )
  ).not.toBe(true)

  const applicationEnv = envByName(application)
  expect(applicationEnv[expectation.nativeEnv.name]?.value ?? '').toContain(expectation.nativeEnv.fragment)
  expect(applicationEnv.DD_TAGS.value).toContain(INJECTION_MODE_TAG)
  expect(tags.service).toBe(appName)
  expect(tags.env).toBe(EXPECTED_ENV)
  expect(tags.version).toBe(expectation.runId)
  expect(tags.dd_sls_ci).toBeDefined()
  expect(tags.dd_sls_injection_mode).toBe('single_language')
  expect(tags.one_e2e_created).toBeDefined()
}

export const verifyUninstrumented = (
  appName: string,
  resourceGroup: string,
  subscriptionId: string,
  nativeEnv?: NativeEnvExpectation
): void => {
  console.log(`Fetching container app "${appName}"...`)
  const app = getContainerApp(appName, resourceGroup, subscriptionId)
  console.log('\nVerifying uninstrumented state:\n')

  const template = app.properties.template
  const config = app.properties.configuration
  const initContainers = template.initContainers || []
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  const sidecar = containers.find((c) => c.name === SIDECAR_NAME)
  expect(sidecar).toBeUndefined()

  const volume = volumes.find((v) => v.name === SHARED_VOLUME_NAME)
  expect(volume).toBeUndefined()
  expect(initContainers.find(({name}) => name === TRACER_NAME)).toBeUndefined()
  expect(volumes.find(({name}) => name === TRACER_NAME)).toBeUndefined()

  for (const container of containers) {
    const env = container.env || []
    const ddVars = env.filter((e) => e.name.startsWith('DD_'))
    expect(ddVars).toHaveLength(0)
    expect(container.volumeMounts ?? []).not.toContainEqual(expect.objectContaining({volumeName: TRACER_NAME}))
    if (nativeEnv) {
      expect(env.find(({name}) => name === nativeEnv.name)?.value ?? '').not.toContain(nativeEnv.fragment)
    }
  }

  const apiKeySecret = secrets.find((s) => s.name === DD_API_KEY_SECRET_NAME)
  expect(apiKeySecret).toBeUndefined()

  for (const tag of DATADOG_TAGS) {
    expect(Object.keys(tags)).not.toContain(tag)
  }
  expect(tags.one_e2e_created).toBeDefined()

  console.log('\nAll uninstrumented checks passed.')
}
