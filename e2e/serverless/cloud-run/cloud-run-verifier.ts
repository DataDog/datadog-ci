import {execSync} from '../../helpers/exec'

interface EnvVar {
  name: string
  value?: string
}

interface VolumeMount {
  name?: string
  volumeName?: string
  mountPath?: string
}

interface Container {
  name: string
  image?: string
  env?: EnvVar[]
  volumeMounts?: VolumeMount[]
}

interface Volume {
  name: string
  emptyDir?: unknown
}

interface ServiceTemplate {
  containers?: Container[]
  volumes?: Volume[]
}

interface CloudRunService {
  labels?: Record<string, string>
  metadata?: {
    labels?: Record<string, string>
  }
  template?: ServiceTemplate
  spec?: {
    template?: {
      spec?: ServiceTemplate
    }
  }
}

const SIDECAR_NAME = 'datadog-sidecar'
const SHARED_VOLUME_NAME = 'shared-volume'
const REQUIRED_ENV_VARS = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_SERVICE',
  'DD_TRACE_ENABLED',
  'DD_LOGS_INJECTION',
  'DD_HEALTH_PORT',
]

const getCloudRunService = (serviceName: string, project: string, region: string): CloudRunService => {
  const output = execSync(
    `gcloud run services describe "${serviceName}"` +
      ` --project "${project}"` +
      ` --region "${region}"` +
      ` --platform managed` +
      ` --format=json`
  )

  return JSON.parse(output)
}

const getTemplate = (service: CloudRunService): ServiceTemplate => {
  return service.template ?? service.spec?.template?.spec ?? {}
}

const getLabels = (service: CloudRunService): Record<string, string> => {
  return service.labels ?? service.metadata?.labels ?? {}
}

const getVolumeName = (mount: VolumeMount): string | undefined => mount.name ?? mount.volumeName

export const verifyInstrumented = (serviceName: string, project: string, region: string): void => {
  console.log(`Fetching Cloud Run service "${serviceName}"...`)
  const service = getCloudRunService(serviceName, project, region)
  console.log('\nVerifying instrumented state:\n')

  const template = getTemplate(service)
  const containers = template.containers || []
  const volumes = template.volumes || []
  const labels = getLabels(service)

  const sidecar = containers.find((c) => c.name === SIDECAR_NAME)
  expect(sidecar).toBeDefined()
  expect(sidecar!.image).toEqual(expect.stringContaining('serverless-init'))

  const volume = volumes.find((v) => v.name === SHARED_VOLUME_NAME)
  expect(volume).toBeDefined()

  const appContainers = containers.filter((c) => c.name !== SIDECAR_NAME)
  expect(appContainers.length).toBeGreaterThan(0)

  for (const container of appContainers) {
    const mounts = container.volumeMounts || []
    expect(mounts.some((m) => getVolumeName(m) === SHARED_VOLUME_NAME)).toBe(true)

    const envNames = (container.env || []).map((e) => e.name)
    for (const varName of REQUIRED_ENV_VARS) {
      expect(envNames).toContain(varName)
    }
  }

  const sidecarMounts = sidecar!.volumeMounts || []
  expect(sidecarMounts.some((m) => getVolumeName(m) === SHARED_VOLUME_NAME)).toBe(true)

  expect(labels.service).toBe(serviceName)
  expect(labels.dd_sls_ci).toBeDefined()

  console.log('\nAll instrumented checks passed.')
}

export const verifyUninstrumented = (serviceName: string, project: string, region: string): void => {
  console.log(`Fetching Cloud Run service "${serviceName}"...`)
  const service = getCloudRunService(serviceName, project, region)
  console.log('\nVerifying uninstrumented state:\n')

  const template = getTemplate(service)
  const containers = template.containers || []
  const volumes = template.volumes || []
  const labels = getLabels(service)

  expect(containers.find((c) => c.name === SIDECAR_NAME)).toBeUndefined()
  expect(volumes.find((v) => v.name === SHARED_VOLUME_NAME)).toBeUndefined()

  for (const container of containers) {
    const mounts = container.volumeMounts || []
    expect(mounts.some((m) => getVolumeName(m) === SHARED_VOLUME_NAME)).toBe(false)

    const ddVars = (container.env || []).filter((e) => e.name.startsWith('DD_'))
    expect(ddVars).toHaveLength(0)
  }

  expect(labels.service).toBeUndefined()
  expect(labels.dd_sls_ci).toBeUndefined()

  console.log('\nAll uninstrumented checks passed.')
}
