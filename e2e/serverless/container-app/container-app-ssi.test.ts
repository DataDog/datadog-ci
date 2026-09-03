import crypto from 'node:crypto'

import {DATADOG_CI_COMMAND, execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {
  getContainerAppUrl,
  verifyMultiLanguageSsiInstrumented,
  verifySsiInstrumented,
  verifyUninstrumented,
} from './container-app-verifier'

const SSI_CASES = [
  {
    language: 'csharp',
    applicationImage: 'dde2etfcapp.azurecr.io/dotnet-ssi:latest',
    tracerRepository: 'dotnet',
    nativeEnv: {name: 'CORECLR_PROFILER_PATH', fragment: '/datadog-lib/Datadog.Trace.ClrProfiler.Native.so'},
  },
  {
    language: 'java',
    applicationImage: 'dde2etfcapp.azurecr.io/java-ssi:latest',
    tracerRepository: 'java',
    nativeEnv: {name: 'JAVA_TOOL_OPTIONS', fragment: '-javaagent:/datadog-lib/dd-java-agent.jar'},
  },
  {
    language: 'nodejs',
    applicationImage: 'dde2etfcapp.azurecr.io/node-ssi:latest',
    tracerRepository: 'js',
    nativeEnv: {name: 'NODE_OPTIONS', fragment: '--require /datadog-lib/node_modules/dd-trace/init.js'},
  },
  {
    language: 'php',
    applicationImage: 'dde2etfcapp.azurecr.io/php-ssi:latest',
    tracerRepository: 'php',
    nativeEnv: {name: 'PHP_INI_SCAN_DIR', fragment: '/datadog-lib/linux-gnu/loader'},
  },
  {
    language: 'python',
    applicationImage: 'dde2etfcapp.azurecr.io/python-ssi:latest',
    tracerRepository: 'python',
    nativeEnv: {name: 'PYTHONPATH', fragment: '/datadog-lib'},
  },
  {
    language: 'ruby',
    applicationImage: 'dde2etfcapp.azurecr.io/ruby-ssi:latest',
    tracerRepository: 'ruby',
    nativeEnv: {name: 'RUBYOPT', fragment: '-r/datadog-lib/auto_inject'},
  },
] as const

const assertCommandSucceeded = (action: string, result: {exitCode: number; stdout: string; stderr: string}): void => {
  if (result.exitCode !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n') || 'no command output'
    throw new Error(`Failed to ${action} container app (exit code ${result.exitCode}): ${output}`)
  }
}

const describeOrSkip =
  process.env.SKIP_CONTAINER_APP_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

describeOrSkip('container-app automatic APM instrumentation', () => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!

  it.concurrent.each(SSI_CASES)(
    'injects, retries, traces, and removes the $language tracer',
    async (ssiCase) => {
      const {language, applicationImage, tracerRepository, nativeEnv} = ssiCase
      const runId = crypto.randomBytes(4).toString('hex')
      const appName = `one-e2e-capp-ssi-${language}-${runId}`
      const instrumentCommand =
        `${DATADOG_CI_COMMAND} container-app instrument` +
        ` -s "${subscriptionId}"` +
        ` -g "${resourceGroup}"` +
        ` -n "${appName}"` +
        ` --service "${appName}"` +
        ` --env e2e` +
        ` --version "${runId}"` +
        ` --extra-tags "one_e2e_run_id:${runId}"` +
        ` --tracing inject` +
        ` --language "${language}"` +
        ` --no-source-code-integration`
      const expectation = {applicationImage, tracerRepository, nativeEnv, runId}

      let lifecycleError: Error | undefined
      let cleanupError: Error | undefined
      try {
        const create = await execPromiseWithRetries(
          `az containerapp create` +
            ` --name "${appName}"` +
            ` --resource-group "${resourceGroup}"` +
            ` --environment "${process.env.AZURE_CONTAINER_APP_ENV}"` +
            ` --image "${applicationImage}"` +
            ` --cpu 0.25 --memory 0.5Gi` +
            ` --min-replicas 0 --max-replicas 1` +
            ` --ingress external --target-port 8080` +
            ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
            ` --output none`
        )
        assertCommandSucceeded('create', create)

        const instrument = await execPromiseWithRetries(instrumentCommand, {
          DD_API_KEY: process.env.DATADOG_API_KEY,
        })
        assertCommandSucceeded('instrument', instrument)
        verifySsiInstrumented(appName, resourceGroup, subscriptionId, expectation)

        const appUrl = getContainerAppUrl(appName, resourceGroup, subscriptionId)
        const [traffic, telemetry] = await Promise.allSettled([
          triggerTraffic(appUrl, {attempts: 20, requiredSuccesses: 10, intervalSeconds: 10}),
          checkTelemetryFlowing(
            {
              serviceName: appName,
              env: 'e2e',
              version: runId,
              tags: [`one_e2e_run_id:${runId}`],
            },
            {checkLogs: false}
          ),
        ])
        if (traffic.status === 'rejected') {
          throw traffic.reason
        }
        if (telemetry.status === 'rejected') {
          throw telemetry.reason
        }

        const retry = await execPromiseWithRetries(instrumentCommand, {
          DD_API_KEY: process.env.DATADOG_API_KEY,
        })
        assertCommandSucceeded('re-instrument', retry)
        verifySsiInstrumented(appName, resourceGroup, subscriptionId, expectation)

        const uninstrument = await execPromiseWithRetries(
          `${DATADOG_CI_COMMAND} container-app uninstrument` +
            ` -s "${subscriptionId}"` +
            ` -g "${resourceGroup}"` +
            ` -n "${appName}"`,
          {DD_API_KEY: process.env.DATADOG_API_KEY}
        )
        assertCommandSucceeded('uninstrument', uninstrument)
        verifyUninstrumented(appName, resourceGroup, subscriptionId, nativeEnv)
      } catch (error) {
        lifecycleError = error instanceof Error ? error : new Error(String(error))
      } finally {
        const cleanup = await execPromiseWithRetries(
          `az containerapp delete --name "${appName}" --resource-group "${resourceGroup}" --yes --output none`
        )
        if (cleanup.exitCode !== 0) {
          const output = [cleanup.stderr, cleanup.stdout].filter(Boolean).join('\n') || 'no command output'
          cleanupError = new Error(`Failed to delete container app (exit code ${cleanup.exitCode}): ${output}`)
        }
      }

      if (lifecycleError && cleanupError) {
        throw new Error(`${String(lifecycleError)}\n${cleanupError.message}`)
      }
      if (cleanupError) {
        throw cleanupError
      }
      if (lifecycleError) {
        throw lifecycleError
      }
    },
    1_200_000
  )

  it('detects Node.js, injects its tracer, and removes the composite', async () => {
    const applicationImage = SSI_CASES.find(({language}) => language === 'nodejs')!.applicationImage
    const runId = crypto.randomBytes(4).toString('hex')
    const appName = `one-e2e-capp-ssi-auto-${runId}`
    const instrumentCommand =
      `${DATADOG_CI_COMMAND} container-app instrument` +
      ` -s "${subscriptionId}"` +
      ` -g "${resourceGroup}"` +
      ` -n "${appName}"` +
      ` --service "${appName}"` +
      ` --env e2e` +
      ` --version "${runId}"` +
      ` --extra-tags "one_e2e_run_id:${runId}"` +
      ` --tracing inject` +
      ` --no-source-code-integration`

    let lifecycleError: Error | undefined
    let cleanupError: Error | undefined
    try {
      const create = await execPromiseWithRetries(
        `az containerapp create` +
          ` --name "${appName}"` +
          ` --resource-group "${resourceGroup}"` +
          ` --environment "${process.env.AZURE_CONTAINER_APP_ENV}"` +
          ` --image "${applicationImage}"` +
          ` --cpu 0.25 --memory 0.5Gi` +
          ` --min-replicas 0 --max-replicas 1` +
          ` --ingress external --target-port 8080` +
          ` --tags one_e2e_created=${Math.floor(Date.now() / 1000)}` +
          ` --output none`
      )
      assertCommandSucceeded('create', create)

      const instrument = await execPromiseWithRetries(instrumentCommand, {DD_API_KEY: process.env.DATADOG_API_KEY})
      assertCommandSucceeded('instrument', instrument)
      verifyMultiLanguageSsiInstrumented(appName, resourceGroup, subscriptionId, runId, applicationImage)

      const appUrl = getContainerAppUrl(appName, resourceGroup, subscriptionId)
      const [traffic, telemetry] = await Promise.allSettled([
        triggerTraffic(appUrl, {attempts: 20, requiredSuccesses: 10, intervalSeconds: 10}),
        checkTelemetryFlowing(
          {serviceName: appName, env: 'e2e', version: runId, tags: [`one_e2e_run_id:${runId}`]},
          {checkLogs: false}
        ),
      ])
      if (traffic.status === 'rejected') {
        throw traffic.reason
      }
      if (telemetry.status === 'rejected') {
        throw telemetry.reason
      }

      const uninstrument = await execPromiseWithRetries(
        `${DATADOG_CI_COMMAND} container-app uninstrument` +
          ` -s "${subscriptionId}"` +
          ` -g "${resourceGroup}"` +
          ` -n "${appName}"`,
        {DD_API_KEY: process.env.DATADOG_API_KEY}
      )
      assertCommandSucceeded('uninstrument', uninstrument)
      verifyUninstrumented(appName, resourceGroup, subscriptionId)
    } catch (error) {
      lifecycleError = error instanceof Error ? error : new Error(String(error))
    } finally {
      const cleanup = await execPromiseWithRetries(
        `az containerapp delete --name "${appName}" --resource-group "${resourceGroup}" --yes --output none`
      )
      if (cleanup.exitCode !== 0) {
        const output = [cleanup.stderr, cleanup.stdout].filter(Boolean).join('\n') || 'no command output'
        cleanupError = new Error(`Failed to delete container app (exit code ${cleanup.exitCode}): ${output}`)
      }
    }

    if (lifecycleError && cleanupError) {
      throw new Error(`${String(lifecycleError)}\n${cleanupError.message}`)
    }
    if (cleanupError) {
      throw cleanupError
    }
    if (lifecycleError) {
      throw lifecycleError
    }
  }, 1_200_000)
})
