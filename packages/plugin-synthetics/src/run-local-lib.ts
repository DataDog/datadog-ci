import {spawn, ChildProcess} from 'child_process'
import * as os from 'os'

import chalk from 'chalk'

import {formatBackendErrors, getApiHelper} from './api'
import {DEFAULT_BATCH_TIMEOUT} from './batch'
import {
  EphemeralPrivateLocation,
  MainReporter,
  RunLocalCommandConfig,
  RunTestsCommandConfig,
  ServerTest,
} from './interfaces'
import {executeTests} from './run-tests-lib'
import {getDefaultConfig as getDefaultConfigBase} from './utils/internal'
import {
  getExitReason,
  getOrgSettings,
  getReporter,
  renderResults,
  reportExitLogs,
  toExitCode,
} from './utils/public'

// The official Datadog synthetics-worker Docker image used for Private Locations
const WORKER_DOCKER_IMAGE = 'gcr.io/datadoghq/synthetics-private-location-worker:latest'

// How long to wait for the Docker worker to come up before triggering the test
const WORKER_STARTUP_WAIT_MS = 5000

export const getDefaultRunLocalConfig = (): RunLocalCommandConfig => ({
  ...getDefaultConfigBase(),
  batchTimeout: DEFAULT_BATCH_TIMEOUT,
  subdomain: 'app',
  testId: '',
})

/**
 * Apply a domain override to a test's starting URL.
 *
 * --override-domain localhost:3000          → replaces just the host+port, keeps protocol
 * --override-domain https://staging.example → replaces protocol, host, and port
 *
 * On macOS/Windows, when running via Docker, `localhost` in the override domain is
 * automatically replaced with `host.docker.internal` so that Chrome inside the Docker
 * container can reach services on the host machine.
 */
export const applyDomainOverride = (startUrl: string, overrideDomain: string, insideDocker = false): string => {
  let url: URL
  try {
    url = new URL(startUrl)
  } catch {
    // startUrl is not a valid URL — return it unchanged
    return startUrl
  }

  if (overrideDomain.startsWith('http://') || overrideDomain.startsWith('https://')) {
    const override = new URL(overrideDomain)
    url.protocol = override.protocol
    url.hostname = override.hostname
    url.port = override.port
  } else {
    // Just a host or host:port — keep the original protocol
    const colonIdx = overrideDomain.indexOf(':')
    if (colonIdx !== -1) {
      url.hostname = overrideDomain.substring(0, colonIdx)
      url.port = overrideDomain.substring(colonIdx + 1)
    } else {
      url.hostname = overrideDomain
      url.port = ''
    }
  }

  let result = url.toString()

  // On non-Linux, Docker containers can't reach the host via `localhost`.
  // Automatically replace it with `host.docker.internal` so Chrome can reach
  // services running on the host machine.
  if (insideDocker && os.platform() !== 'linux') {
    result = result.replace(/\blocalhost\b/g, 'host.docker.internal')
    result = result.replace(/\b127\.0\.0\.1\b/g, 'host.docker.internal')
  }

  return result
}

/**
 * Spawn the synthetics-worker Docker container in Private Location mode.
 *
 * The worker will poll Datadog for tests assigned to the ephemeral PL,
 * execute them locally, and submit results back to Datadog.
 */
export const spawnDockerWorker = (config: {
  accessKey: string
  secretAccessKey: string
  datadogApiKey: string
  site: string
}): ChildProcess => {
  const isLinux = os.platform() === 'linux'

  const dockerArgs = [
    'run',
    '--rm',
    // On Linux use host networking so Chrome can reach localhost services directly.
    // On macOS/Windows Docker Desktop, add a host alias for host.docker.internal.
    ...(isLinux ? ['--network=host'] : ['--add-host=host.docker.internal:host-gateway']),
    '-e',
    `DATADOG_ACCESS_KEY=${config.accessKey}`,
    '-e',
    `DATADOG_SECRET_ACCESS_KEY=${config.secretAccessKey}`,
    '-e',
    `DATADOG_API_KEY=${config.datadogApiKey}`,
    '-e',
    `DATADOG_SITE=${config.site}`,
    WORKER_DOCKER_IMAGE,
  ]

  return spawn('docker', dockerArgs, {stdio: ['ignore', 'pipe', 'pipe']})
}

/**
 * Main entrypoint for `datadog-ci synthetics run-local`.
 *
 * Orchestrates the full lifecycle:
 *   1. Fetch the test definition from Datadog
 *   2. Compute the overridden starting URL (if --override-domain was provided)
 *   3. Register an ephemeral Private Location via the Datadog API
 *   4. Spin up the synthetics-worker Docker container with the PL credentials
 *   5. Trigger the test via the normal CI trigger API, with a location override
 *      pointing to the ephemeral PL
 *   6. Poll for results using the existing batch-result infrastructure
 *   7. Render the result and return an exit code
 *   8. Clean up: kill the Docker container, delete the ephemeral PL
 */
export const executeRunLocal = async (reporter: MainReporter, config: RunLocalCommandConfig): Promise<number> => {
  const api = getApiHelper(config)

  // ─── Step 1: Fetch test ────────────────────────────────────────────────────
  reporter.log(`\nFetching test "${config.testId}"...\n`)
  let test: ServerTest
  try {
    test = await api.getTest(config.testId)
  } catch (error) {
    reporter.error(`${chalk.red.bold('Failed to fetch test')} "${config.testId}":\n  ${formatBackendErrors(error)}\n`)

    return 1
  }
  reporter.log(`Fetched test ${chalk.bold(`"${test.name}"`)} (${config.testId})\n`)

  // ─── Step 2: Apply domain override ────────────────────────────────────────
  const originalStartUrl: string | undefined = test.config?.request?.url
  let startUrlOverride: string | undefined

  if (config.overrideDomain && originalStartUrl) {
    // insideDocker=true so we auto-translate localhost → host.docker.internal on Mac/Windows
    startUrlOverride = applyDomainOverride(originalStartUrl, config.overrideDomain, true)
    reporter.log(`Overriding starting URL: ${chalk.gray(originalStartUrl)} → ${chalk.cyan(startUrlOverride)}\n`)
  }

  // ─── Step 3: Create ephemeral Private Location ────────────────────────────
  reporter.log('Registering ephemeral local worker...\n')
  let pl: EphemeralPrivateLocation
  try {
    const plName = `local-run-${Date.now().toString(36)}`
    pl = await api.createPrivateLocation(plName)
    reporter.log(`Ephemeral Private Location created: ${chalk.gray(pl.id)}\n`)
  } catch (error) {
    reporter.error(
      `${chalk.red.bold('Failed to create ephemeral Private Location')}:\n  ${formatBackendErrors(error)}\n`
    )

    return 1
  }

  // ─── Step 4: Spawn Docker worker ──────────────────────────────────────────
  reporter.log(`Starting local worker (${chalk.gray(WORKER_DOCKER_IMAGE)})...\n`)
  const worker = spawnDockerWorker({
    accessKey: pl.accessKey,
    secretAccessKey: pl.secretAccessKey,
    datadogApiKey: config.apiKey,
    site: config.datadogSite,
  })

  let workerExited = false
  worker.on('exit', (code) => {
    workerExited = true
    if (code !== 0 && code !== null) {
      reporter.log(chalk.yellow(`[worker] exited with code ${code}\n`))
    }
  })

  // Forward worker stderr to the reporter so the user can see what's happening
  worker.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trim()
    if (lines) {
      reporter.log(chalk.gray(`[worker] ${lines}\n`))
    }
  })

  // ─── Cleanup helper ───────────────────────────────────────────────────────
  const cleanup = async () => {
    if (!workerExited) {
      worker.kill()
    }
    try {
      await api.deletePrivateLocation(pl.id)
    } catch {
      // Best-effort — the PL will eventually expire on the server side
    }
  }

  const handleSignal = async () => {
    reporter.log('\nInterrupted. Cleaning up...\n')
    await cleanup()
    process.exit(130)
  }

  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    // Give the worker a few seconds to establish its polling connection before
    // we trigger the test. Without this, the test might land in the queue before
    // the worker is ready and could time out or be picked up by a different PL.
    reporter.log(`Waiting for worker to come online...\n`)
    await new Promise<void>((resolve) => setTimeout(resolve, WORKER_STARTUP_WAIT_MS))

    reporter.log('Running test locally...\n')

    // ─── Step 5+6: Trigger + poll using existing run-tests infrastructure ──
    const runTestsConfig: RunTestsCommandConfig = {
      // Auth + site
      apiKey: config.apiKey,
      appKey: config.appKey,
      configPath: config.configPath,
      datadogSite: config.datadogSite,
      proxy: config.proxy,

      // Test selection: the single test ID
      publicIds: [config.testId],
      files: [],
      testSearchQuery: '',

      // Overrides: force the test to run on our ephemeral PL with the domain override
      defaultTestOverrides: {
        locations: [pl.id],
        ...(startUrlOverride ? {startUrl: startUrlOverride} : {}),
        ...(config.ignoreTlsErrors ? {allowInsecureCertificates: true} : {}),
      },

      // Timeouts and failure behavior
      batchTimeout: config.batchTimeout,
      failOnCriticalErrors: false,
      failOnMissingTests: false,
      failOnTimeout: true,

      // Misc
      subdomain: config.subdomain,
      tunnel: false,
      selectiveRerun: false,
    }

    const startTime = Date.now()
    const {results, summary} = await executeTests(reporter, runTestsConfig)

    // ─── Step 7: Render results ───────────────────────────────────────────
    const orgSettings = await getOrgSettings(reporter, runTestsConfig)

    renderResults({
      config: runTestsConfig,
      orgSettings,
      reporter,
      results,
      startTime,
      summary,
    })

    reportExitLogs(reporter, runTestsConfig, {results})

    return toExitCode(getExitReason(runTestsConfig, {results}))
  } catch (error) {
    reportExitLogs(reporter, {failOnTimeout: true, failOnCriticalErrors: false}, {error})

    return toExitCode(getExitReason({failOnCriticalErrors: false, failOnMissingTests: false}, {error}))
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
    await cleanup()
  }
}
