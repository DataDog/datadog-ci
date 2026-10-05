import crypto from 'node:crypto'

import {DATADOG_CI_COMMAND, execPromiseWithRetries} from '../../helpers/exec'

import {SSI_CASES as ssiCases} from '../helpers/ssi'
import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {
  getContainerAppUrl,
  verifyMultiLanguageSsiInstrumented,
  verifySsiInstrumented,
  verifyUninstrumented,
} from './container-app-verifier'

const SSI_CASES = [
  ...ssiCases.map(({fixtureImageName, nativeEnv, ...ssiCase}) => ({
    ...ssiCase,
    kind: 'single-language' as const,
    testName: ssiCase.language,
    applicationImage: `dde2etfcapp.azurecr.io/${fixtureImageName}:latest`,
    nativeEnv: {name: nativeEnv.name, fragment: nativeEnv.value},
  })),
  {
    kind: 'multi-language',
    testName: 'auto-detected Node.js at the 2-GiB ephemeral-storage boundary',
    applicationImage: 'dde2etfcapp.azurecr.io/node-ssi:latest',
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
    'injects, retries, traces, and removes the $testName tracer',
    async (ssiCase) => {
      const {applicationImage} = ssiCase
      const runId = crypto.randomBytes(4).toString('hex')
      const appName = `one-e2e-capp-ssi-${ssiCase.kind === 'single-language' ? ssiCase.language : 'auto'}-${runId}`
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
        (ssiCase.kind === 'single-language' ? ` --language "${ssiCase.language}"` : '') +
        (ssiCase.kind === 'multi-language' ? ' --sidecar-cpu 0.25 --sidecar-memory 0.5' : '') +
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

        const instrument = await execPromiseWithRetries(instrumentCommand, {
          DD_API_KEY: process.env.DATADOG_API_KEY,
        })
        assertCommandSucceeded('instrument', instrument)
        if (ssiCase.kind === 'single-language') {
          verifySsiInstrumented(appName, resourceGroup, subscriptionId, {...ssiCase, runId})
        } else {
          verifyMultiLanguageSsiInstrumented(appName, resourceGroup, subscriptionId, runId, applicationImage)
        }

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
            {checkLogs: false, maxAttempts: 40}
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
        if (ssiCase.kind === 'single-language') {
          verifySsiInstrumented(appName, resourceGroup, subscriptionId, {...ssiCase, runId})
        } else {
          verifyMultiLanguageSsiInstrumented(appName, resourceGroup, subscriptionId, runId, applicationImage)
        }

        const uninstrument = await execPromiseWithRetries(
          `${DATADOG_CI_COMMAND} container-app uninstrument` +
            ` -s "${subscriptionId}"` +
            ` -g "${resourceGroup}"` +
            ` -n "${appName}"`,
          {DD_API_KEY: process.env.DATADOG_API_KEY}
        )
        assertCommandSucceeded('uninstrument', uninstrument)
        verifyUninstrumented(
          appName,
          resourceGroup,
          subscriptionId,
          ssiCase.kind === 'single-language' ? ssiCase.nativeEnv : undefined
        )
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
})
