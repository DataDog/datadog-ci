'use strict'

const { execSync } = require('child_process')

const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID
const RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP
const CONTAINER_APP_NAME = process.env.AZURE_CONTAINER_APP_NAME

const mode = process.argv[2]
if (mode !== 'instrumented' && mode !== 'uninstrumented') {
  console.error('Usage: node verify-container-app.js <instrumented|uninstrumented>')
  process.exit(1)
}

if (!SUBSCRIPTION_ID || !RESOURCE_GROUP || !CONTAINER_APP_NAME) {
  console.error('Missing required env vars: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_CONTAINER_APP_NAME')
  process.exit(1)
}

function getContainerApp() {
  const output = execSync(
    `az containerapp show --subscription "${SUBSCRIPTION_ID}" --resource-group "${RESOURCE_GROUP}" --name "${CONTAINER_APP_NAME}" --output json`,
    { encoding: 'utf-8' }
  )
  return JSON.parse(output)
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`)
    return false
  }
  console.log(`  OK: ${message}`)
  return true
}

function verifyInstrumented(app) {
  const template = app.properties.template
  const config = app.properties.configuration
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  let ok = true

  console.log('Checking sidecar container...')
  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  ok = assert(sidecar, 'datadog-sidecar container exists') && ok
  if (sidecar) {
    ok = assert(sidecar.image.includes('datadog/serverless-init'), `sidecar image is datadog/serverless-init (got ${sidecar.image})`) && ok
  }

  console.log('Checking shared volume...')
  const volume = volumes.find((v) => v.name === 'shared-volume')
  ok = assert(volume, 'shared-volume exists') && ok
  if (volume) {
    ok = assert(volume.storageType === 'EmptyDir', `shared-volume storageType is EmptyDir (got ${volume.storageType})`) && ok
  }

  console.log('Checking volume mounts on app containers...')
  const appContainers = containers.filter((c) => c.name !== 'datadog-sidecar')
  for (const container of appContainers) {
    const mounts = container.volumeMounts || []
    const mount = mounts.find((m) => m.volumeName === 'shared-volume')
    ok = assert(mount, `container "${container.name}" has shared-volume mount`) && ok
  }

  console.log('Checking DD_* env vars on app containers...')
  const requiredEnvVars = ['DD_TRACE_ENABLED', 'DD_LOGS_INJECTION', 'DD_HEALTH_PORT']
  for (const container of appContainers) {
    const env = container.env || []
    const envNames = env.map((e) => e.name)
    for (const varName of requiredEnvVars) {
      ok = assert(envNames.includes(varName), `container "${container.name}" has ${varName}`) && ok
    }
  }

  console.log('Checking dd-api-key secret...')
  const apiKeySecret = secrets.find((s) => s.name === 'dd-api-key')
  ok = assert(apiKeySecret, 'dd-api-key secret exists') && ok

  console.log('Checking tags...')
  ok = assert(Object.keys(tags).some((k) => k === 'dd_sls_ci'), 'dd_sls_ci tag exists') && ok

  return ok
}

function verifyUninstrumented(app) {
  const template = app.properties.template
  const config = app.properties.configuration
  const containers = template.containers || []
  const volumes = template.volumes || []
  const secrets = config.secrets || []
  const tags = app.tags || {}

  let ok = true

  console.log('Checking no sidecar container...')
  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  ok = assert(!sidecar, 'datadog-sidecar container does not exist') && ok

  console.log('Checking no shared volume...')
  const volume = volumes.find((v) => v.name === 'shared-volume')
  ok = assert(!volume, 'shared-volume does not exist') && ok

  console.log('Checking no DD_* env vars...')
  for (const container of containers) {
    const env = container.env || []
    const ddVars = env.filter((e) => e.name.startsWith('DD_'))
    ok = assert(ddVars.length === 0, `container "${container.name}" has no DD_* env vars (found ${ddVars.length})`) && ok
  }

  console.log('Checking no dd-api-key secret...')
  const apiKeySecret = secrets.find((s) => s.name === 'dd-api-key')
  ok = assert(!apiKeySecret, 'dd-api-key secret does not exist') && ok

  console.log('Checking no dd_sls_ci tag...')
  ok = assert(!Object.keys(tags).some((k) => k === 'dd_sls_ci'), 'dd_sls_ci tag does not exist') && ok

  return ok
}

console.log(`Fetching container app "${CONTAINER_APP_NAME}"...`)
const app = getContainerApp()

console.log(`\nVerifying ${mode} state:\n`)
const ok = mode === 'instrumented' ? verifyInstrumented(app) : verifyUninstrumented(app)

if (ok) {
  console.log(`\n✅ All ${mode} checks passed.`)
  process.exit(0)
} else {
  console.log(`\n❌ Some ${mode} checks failed.`)
  process.exit(1)
}
