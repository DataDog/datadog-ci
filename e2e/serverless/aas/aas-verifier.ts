import {execFileSync} from 'node:child_process'

import {execSync} from '../../helpers/exec'

// Hard-coded because e2e tests run against built artifacts, can't import from source
const AAS_DD_SETTING_NAMES = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_AAS_INSTANCE_LOGGING_ENABLED',
  'DD_SERVICE',
  'DD_ENV',
  'DD_VERSION',
  'DD_SERVERLESS_LOG_PATH',
  'DD_DOTNET_TRACER_HOME',
  'DD_TRACE_LOG_DIRECTORY',
  'CORECLR_ENABLE_PROFILING',
  'CORECLR_PROFILER',
  'CORECLR_PROFILER_PATH',
  'DD_TAGS',
  'WEBSITES_ENABLE_APP_SERVICE_STORAGE',
]

const getAppSettings = (appName: string, rg: string): Record<string, string> => {
  const output = execSync(
    `az webapp config appsettings list --name "${appName}" --resource-group "${rg}" --output json`
  )
  const settings: {name: string; value: string}[] = JSON.parse(output)

  return Object.fromEntries(settings.map((s) => [s.name, s.value]))
}

interface WebApp {
  tags?: Record<string, string>
}

const getWebApp = (appName: string, rg: string): WebApp => {
  const output = execSync(`az webapp show --name "${appName}" --resource-group "${rg}" --output json`)

  return JSON.parse(output)
}

const runKuduCommand = (appName: string, rg: string, command: string): {ExitCode?: number} => {
  const credentials = JSON.parse(
    execSync(
      `az webapp deployment list-publishing-credentials --name "${appName}" --resource-group "${rg}" --output json`
    )
  )
  const properties = credentials.properties ?? credentials
  const scmUrl = new URL(properties.scmUri)
  const accessToken = execSync(
    'az account get-access-token --resource https://management.azure.com/ --query accessToken --output tsv'
  ).trim()

  return JSON.parse(
    execFileSync(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--header',
        `Authorization: Bearer ${accessToken}`,
        '--header',
        'Content-Type: application/json',
        '--data',
        JSON.stringify({command, dir: '/'}),
        `${scmUrl.origin}/api/command`,
      ],
      {encoding: 'utf8'}
    )
  )
}

const verifyStagedTracer = (appName: string, rg: string, expected: boolean): void => {
  const result = runKuduCommand(appName, rg, 'test -d /home/data/datadog-tracer')
  if (expected) {
    expect(result.ExitCode).toBe(0)
  } else {
    expect(result.ExitCode).not.toBe(0)
  }
}

interface SiteContainer {
  name: string
  properties: {
    image: string
    targetPort?: number
  }
}

const getSiteContainers = (appName: string, rg: string, subscriptionId: string): SiteContainer[] => {
  try {
    const url = `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${appName}/sitecontainers?api-version=2024-11-01`
    const output = execSync(`az rest --method get --url "${url}" --output json`)
    const result = JSON.parse(output)

    return result.value || []
  } catch {
    return []
  }
}

interface SiteExtension {
  id: string
}

const getSiteExtensions = (appName: string, rg: string, subscriptionId: string): SiteExtension[] => {
  try {
    const url = `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${appName}/siteextensions?api-version=2024-11-01`
    const output = execSync(`az rest --method get --url "${url}" --output json`)
    const result = JSON.parse(output)

    return result.value || []
  } catch {
    return []
  }
}

export const verifyLinuxInstrumented = (
  appName: string,
  rg: string,
  subscriptionId: string,
  expectSsi = false
): void => {
  console.log(`Verifying Linux app "${appName}" is instrumented...\n`)

  const settings = getAppSettings(appName, rg)
  const requiredSettings = [
    'DD_API_KEY',
    'DD_SITE',
    'DD_SERVICE',
    'DD_AAS_INSTANCE_LOGGING_ENABLED',
    'WEBSITES_ENABLE_APP_SERVICE_STORAGE',
  ]
  for (const name of requiredSettings) {
    expect(settings[name]).toBeDefined()
  }
  // Logs only flow when instance logging is enabled (--instance-logging).
  expect(settings['DD_AAS_INSTANCE_LOGGING_ENABLED']).toBe('true')
  if (expectSsi) {
    expect(settings.NODE_OPTIONS).toContain('/home/data/datadog-tracer/nodejs/')
    expect(settings.NODE_OPTIONS).toContain('/init.js')
    expect(settings.DD_TAGS).toContain('dd_sls_injection_mode:single_language')
  }

  const containers = getSiteContainers(appName, rg, subscriptionId)
  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  expect(sidecar).toBeDefined()
  expect(sidecar!.properties.image).toEqual(expect.stringContaining('datadog/serverless-init'))
  expect(String(sidecar!.properties.targetPort)).toBe('8126')

  const app = getWebApp(appName, rg)
  const tags = app.tags || {}
  expect(Object.keys(tags)).toContain('service')
  expect(Object.keys(tags)).toContain('dd_sls_ci')
  if (expectSsi) {
    expect(tags.dd_sls_injection_mode).toBe('single_language')
    verifyStagedTracer(appName, rg, true)
  }

  console.log('All Linux instrumented checks passed.\n')
}

export const verifyLinuxUninstrumented = (
  appName: string,
  rg: string,
  subscriptionId: string,
  expectSsi = false
): void => {
  console.log(`Verifying Linux app "${appName}" is uninstrumented...\n`)

  const settings = getAppSettings(appName, rg)
  for (const name of AAS_DD_SETTING_NAMES) {
    expect(settings[name]).toBeUndefined()
  }

  const containers = getSiteContainers(appName, rg, subscriptionId)
  const sidecar = containers.find((c) => c.name === 'datadog-sidecar')
  expect(sidecar).toBeUndefined()

  const app = getWebApp(appName, rg)
  const tags = app.tags || {}
  expect(Object.keys(tags)).not.toContain('service')
  expect(Object.keys(tags)).not.toContain('dd_sls_ci')
  if (expectSsi) {
    expect(tags.dd_sls_injection_mode).toBeUndefined()
    verifyStagedTracer(appName, rg, false)
  }

  console.log('All Linux uninstrumented checks passed.\n')
}

export const verifyWindowsInstrumented = (appName: string, rg: string, subscriptionId: string): void => {
  console.log(`Verifying Windows app "${appName}" is instrumented...\n`)

  const settings = getAppSettings(appName, rg)
  const requiredSettings = ['DD_API_KEY', 'DD_SITE', 'DD_SERVICE', 'DD_AAS_INSTANCE_LOGGING_ENABLED']
  for (const name of requiredSettings) {
    expect(settings[name]).toBeDefined()
  }

  const extensions = getSiteExtensions(appName, rg, subscriptionId)
  const ddExtension = extensions.find((e) => e.id.includes('Datadog.AzureAppServices.Node.Apm'))
  expect(ddExtension).toBeDefined()

  const app = getWebApp(appName, rg)
  const tags = app.tags || {}
  expect(Object.keys(tags)).toContain('service')
  expect(Object.keys(tags)).toContain('dd_sls_ci')

  console.log('All Windows instrumented checks passed.\n')
}

export const verifyWindowsUninstrumented = (appName: string, rg: string, subscriptionId: string): void => {
  console.log(`Verifying Windows app "${appName}" is uninstrumented...\n`)

  const settings = getAppSettings(appName, rg)
  for (const name of AAS_DD_SETTING_NAMES) {
    expect(settings[name]).toBeUndefined()
  }

  const extensions = getSiteExtensions(appName, rg, subscriptionId)
  const ddExtensions = extensions.filter((e) => e.id.includes('Datadog.AzureAppServices.'))
  expect(ddExtensions).toHaveLength(0)

  const app = getWebApp(appName, rg)
  const tags = app.tags || {}
  expect(Object.keys(tags)).not.toContain('service')
  expect(Object.keys(tags)).not.toContain('dd_sls_ci')

  console.log('All Windows uninstrumented checks passed.\n')
}
