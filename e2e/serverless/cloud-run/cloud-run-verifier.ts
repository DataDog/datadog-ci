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
  name?: string
  image?: string
  args?: string[]
  dependsOn?: string[]
  env?: EnvVar[]
  resources?: {limits?: Record<string, string>}
  startupProbe?: {
    tcpSocket?: {port?: number}
  }
  volumeMounts?: VolumeMount[]
}

interface Volume {
  name: string
  emptyDir?: {medium?: string; sizeLimit?: string}
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
      metadata?: {annotations?: Record<string, string>}
      spec?: ServiceTemplate
    }
  }
}

const SIDECAR_NAME = 'datadog-sidecar'
const SHARED_VOLUME_NAME = 'shared-volume'
const TRACER_COPY_CONTAINER_NAME = 'datadog-tracer'
const SINGLE_TRACER_MOUNT_PATH = '/datadog-lib'
const COMPOSITE_TRACER_MOUNT_PATH = '/opt/datadog-packages'
const COMPOSITE_PRELOAD = `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so`
const COMPOSITE_COMPLETION_MARKER = `${COMPOSITE_TRACER_MOUNT_PATH}/.datadog-composite-copy-finished`
const TRACER_READINESS_PORT = 18999
const TRACER_VOLUME_NAME = 'datadog-tracer'
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

const getTemplate = (service: CloudRunService): ServiceTemplate =>
  service.template?.containers?.length ? service.template : (service.spec?.template?.spec ?? service.template ?? {})

const getLabels = (service: CloudRunService): Record<string, string> => ({
  ...service.metadata?.labels,
  ...service.labels,
})

const getVolumeName = (mount: VolumeMount): string | undefined => mount.name ?? mount.volumeName

const getContainerDependencies = (service: CloudRunService, container: Container): string[] | undefined =>
  container.dependsOn ??
  JSON.parse(service.spec?.template?.metadata?.annotations?.['run.googleapis.com/container-dependencies'] ?? '{}')[
    container.name ?? ''
  ]

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

  const appContainers = containers.filter((c) => c.name !== SIDECAR_NAME && c.name !== TRACER_COPY_CONTAINER_NAME)
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

interface SsiExpectation {
  appImage: string
  tracerRepository: string
  envName: string
  envValue: string
}

export const verifySsiInstrumented = (
  serviceName: string,
  project: string,
  region: string,
  expectation: SsiExpectation
): void => {
  const service = getCloudRunService(serviceName, project, region)
  const template = getTemplate(service)
  const containers = template.containers ?? []
  const labels = getLabels(service)
  const appContainers = containers.filter(({name}) => name !== SIDECAR_NAME && name !== TRACER_COPY_CONTAINER_NAME)

  expect(appContainers).toHaveLength(1)
  const app = appContainers[0]
  expect(app.image).toBe(expectation.appImage)
  expect(app.volumeMounts).toContainEqual({name: TRACER_VOLUME_NAME, mountPath: SINGLE_TRACER_MOUNT_PATH})
  expect(app.env).toEqual(
    expect.arrayContaining([
      expect.objectContaining({name: 'DD_TRACE_ENABLED', value: 'true'}),
      expect.objectContaining({name: expectation.envName, value: expect.stringContaining(expectation.envValue)}),
    ])
  )

  const tracerCopy = containers.find(({name}) => name === TRACER_COPY_CONTAINER_NAME)
  expect(tracerCopy).toBeDefined()
  expect(tracerCopy!.image).toContain(`/dd-lib-${expectation.tracerRepository}-init:latest`)
  expect(tracerCopy!.volumeMounts).toContainEqual({
    name: TRACER_VOLUME_NAME,
    mountPath: SINGLE_TRACER_MOUNT_PATH,
  })
  expect(tracerCopy!.startupProbe?.tcpSocket?.port).toBe(TRACER_READINESS_PORT)
  expect(tracerCopy!.args).toContain(String(TRACER_READINESS_PORT))

  expect(template.volumes).toEqual(
    expect.arrayContaining([expect.objectContaining({name: TRACER_VOLUME_NAME, emptyDir: expect.anything()})])
  )
  expect(labels.dd_sls_injection_mode).toBe('single_language')
}

interface MultiLanguageSsiExpectation {
  appImage: string
}

export const verifyMultiLanguageSsiInstrumented = (
  serviceName: string,
  project: string,
  region: string,
  expectation: MultiLanguageSsiExpectation
): void => {
  const service = getCloudRunService(serviceName, project, region)
  const template = getTemplate(service)
  const containers = template.containers ?? []
  const labels = getLabels(service)
  const appContainers = containers.filter(({name}) => name !== SIDECAR_NAME && name !== TRACER_COPY_CONTAINER_NAME)

  expect(appContainers).toHaveLength(1)
  const app = appContainers[0]
  expect(app.image).toBe(expectation.appImage)
  expect(getContainerDependencies(service, app)).toEqual(
    expect.arrayContaining([SIDECAR_NAME, TRACER_COPY_CONTAINER_NAME])
  )
  expect(app.volumeMounts).toContainEqual({name: TRACER_VOLUME_NAME, mountPath: COMPOSITE_TRACER_MOUNT_PATH})
  expect(app.env).toEqual(
    expect.arrayContaining([
      expect.objectContaining({name: 'DD_TRACE_ENABLED', value: 'true'}),
      expect.objectContaining({name: 'LD_PRELOAD', value: expect.stringContaining(COMPOSITE_PRELOAD)}),
      expect.objectContaining({name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'}),
    ])
  )

  const tracerCopy = containers.find(({name}) => name === TRACER_COPY_CONTAINER_NAME)
  expect(tracerCopy).toBeDefined()
  expect(tracerCopy!.image).toContain('/dd-lib-composite-init:latest')
  expect(tracerCopy!.volumeMounts).toContainEqual({
    name: TRACER_VOLUME_NAME,
    mountPath: COMPOSITE_TRACER_MOUNT_PATH,
  })
  expect(tracerCopy!.resources?.limits?.memory).toBe('2Gi')
  expect(tracerCopy!.startupProbe?.tcpSocket?.port).toBe(TRACER_READINESS_PORT)
  expect(tracerCopy!.args).toEqual(
    expect.arrayContaining([COMPOSITE_TRACER_MOUNT_PATH, COMPOSITE_COMPLETION_MARKER, String(TRACER_READINESS_PORT)])
  )

  expect(template.volumes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: TRACER_VOLUME_NAME,
        emptyDir: expect.objectContaining({medium: expect.stringMatching(/^memory$/i), sizeLimit: '1.5Gi'}),
      }),
    ])
  )
  expect(labels.dd_sls_injection_mode).toBe('multi_language')
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
  expect(containers.find((c) => c.name === TRACER_COPY_CONTAINER_NAME)).toBeUndefined()
  expect(volumes.find((v) => v.name === SHARED_VOLUME_NAME)).toBeUndefined()
  expect(volumes.find((v) => v.name === TRACER_VOLUME_NAME)).toBeUndefined()

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
