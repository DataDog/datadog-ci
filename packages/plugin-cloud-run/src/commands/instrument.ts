import type {IContainer, IEnvVar, IService, IServiceTemplate} from '../types'

import {CloudRunInstrumentCommand} from '@datadog/datadog-ci-base/commands/cloud-run/instrument'
import {DATADOG_SITE_US1, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {
  DD_LOG_LEVEL_ENV_VAR,
  DD_SOURCE_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  HEALTH_PORT_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  CI_SITE_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import {ServicesClient} from '@google-cloud/run'
import chalk from 'chalk'

import {requestGCPProject, requestGCPRegion, requestServiceName, requestSite, requestConfirmation} from '../prompt'
import {dryRunPrefix, renderAuthenticationInstructions, withSpinner} from '../renderer'
import {checkAuthentication, fetchServiceConfigs} from '../utils'

// equivalent to google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const EMPTY_DIR_VOLUME_SOURCE_MEMORY = 1

const DEFAULT_HEALTH_CHECK_PORT = 5555

const DEFAULT_ENV_VARS: IEnvVar[] = [
  {name: SITE_ENV_VAR, value: DATADOG_SITE_US1},
  {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
  {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
  {name: HEALTH_PORT_ENV_VAR, value: DEFAULT_HEALTH_CHECK_PORT.toString()},
]

export class PluginCommand extends CloudRunInstrumentCommand {
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.context.stdout.write(
      `\n${dryRunPrefix(this.dryRun)}🐶 ${chalk.bold('Instrumenting Cloud Run service(s)')}\n\n`
    )

    // Verify DD API Key
    const site = process.env.DD_SITE ?? DATADOG_SITE_US1
    try {
      const isApiKeyValid = await newApiKeyValidator({
        apiKey: process.env.DD_API_KEY,
        datadogSite: site,
      }).validateApiKey()
      if (!isApiKeyValid) {
        throw Error()
      }
    } catch (e) {
      this.context.stdout.write(
        renderSoftWarning(
          `Invalid API Key stored in the environment variable ${chalk.bold('DD_API_KEY')}: ${maskString(
            process.env.DD_API_KEY ?? ''
          )} and ${chalk.bold('DD_SITE')}: ${site}\nEnsure you've set both DD_API_KEY and DD_SITE.`
        )
      )

      return 1
    }

    if (this.interactive) {
      if (!this.project) {
        this.project = await requestGCPProject()
      }

      if (!this.region) {
        this.region = await requestGCPRegion()
      }

      if (this.services.length === 0) {
        const serviceName = await requestServiceName()
        this.services = [serviceName]
      }

      const envSite = process.env[CI_SITE_ENV_VAR]
      if (!isValidDatadogSite(envSite)) {
        process.env[CI_SITE_ENV_VAR] = await requestSite()
      }
    }

    // Validate required variables
    if (!this.project) {
      this.context.stdout.write(chalk.yellow('Invalid or missing project. Please use the --project flag.\n'))
    }
    if (this.services.length === 0) {
      this.context.stdout.write(chalk.yellow('Invalid or missing service(s). Please use the --service flag.\n'))
    }
    if (!this.region) {
      this.context.stdout.write(chalk.yellow('Invalid or missing region. Please use the --region flag.\n'))
    }

    const ddService = process.env[SERVICE_ENV_VAR]
    if (!ddService) {
      this.context.stdout.write(renderSoftWarning('No DD_SERVICE env var found. Will default to the service name.'))
    }

    if (this.extraTags && !this.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      this.context.stderr.write(renderError('Extra tags do not comply with the <key>:<value> array.\n'))

      return 1
    }

    if (!this.project || !this.services || !this.services.length || !this.region) {
      return 1
    }
    this.context.stdout.write(chalk.green('✔ Required flags verified\n'))

    // Verify GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    const authenticated = await checkAuthentication()
    if (!authenticated) {
      this.context.stderr.write(renderAuthenticationInstructions())

      return 1
    }
    this.context.stdout.write(chalk.green('✔ GCP credentials verified!\n\n'))

    if (this.sourceCodeIntegration) {
      this.extraTags = await handleSourceCodeIntegration(this.context, this.uploadGitMetadata, this.extraTags)
    }

    // Instrument services with sidecar
    try {
      await this.instrumentSidecar(this.project, this.services, this.region, ddService)
    } catch (error) {
      this.context.stderr.write(dryRunPrefix(this.dryRun) + renderError(`Uninstrumentation failed: ${error}\n`))

      return 1
    }

    if (!this.dryRun) {
      this.context.stdout.write('\n✅ Cloud Run instrumentation completed successfully!\n')
    }

    return 0
  }

  public async instrumentSidecar(project: string, services: string[], region: string, ddService: string | undefined) {
    const client = new ServicesClient()

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}⬇️ Fetching existing service configurations from Cloud Run...\n`)
    )
    const existingServiceConfigs = await fetchServiceConfigs(client, project, region, services)

    this.context.stdout.write(
      chalk.bold(`\n${dryRunPrefix(this.dryRun)}🚀 Instrumenting Cloud Run services with sidecar...\n`)
    )
    for (let i = 0; i < existingServiceConfigs.length; i++) {
      const serviceConfig = existingServiceConfigs[i]
      const serviceName = services[i]
      try {
        const actualDDService = ddService ?? serviceName
        await this.instrumentService(client, serviceConfig, serviceName, actualDDService)
      } catch (error) {
        this.context.stderr.write(
          dryRunPrefix(this.dryRun) + renderError(`Failed to instrument service ${serviceName}: ${error}\n`)
        )
        throw error
      }
    }
  }

  public async instrumentService(
    client: ServicesClient,
    existingService: IService,
    serviceName: string,
    ddService: string
  ) {
    const updatedService = this.createInstrumentedServiceConfig(existingService, ddService)
    this.context.stdout.write(generateConfigDiff(existingService, updatedService))
    if (this.dryRun) {
      this.context.stdout.write(
        `\n\n${dryRunPrefix(this.dryRun)}Would have updated service ${chalk.bold(
          serviceName
        )} with the above changes.\n`
      )

      return
    } else if (this.interactive) {
      const confirmed = await requestConfirmation('\nDo you want to apply the changes?')
      if (!confirmed) {
        throw new Error('Instrumentation cancelled by user.')
      }
    }

    await withSpinner(
      `Instrumenting service ${chalk.bold(serviceName)}...`,
      async () => {
        const [operation] = await client.updateService({
          service: updatedService,
        })
        await operation.promise()
      },
      `Instrumented service ${chalk.bold(serviceName)}`
    )
  }

  public createInstrumentedServiceConfig(service: IService, ddService: string): IService {
    const config: ServerlessConfigOptions = {
      service: ddService,
      environment: this.environment,
      version: this.version,
      logPath: this.logsPath,
      extraTags: this.extraTags,
      isInstanceLoggingEnabled: true,
    }
    const envVarsByName = this.getEnvVarsByName(config)
    const template: IServiceTemplate = createInstrumentedTemplate(
      config,
      service.template || {},
      this.buildBaseSidecarContainer(service.template?.containers?.find((c) => c.name === this.sidecarName)),
      {name: this.sharedVolumeName, mountPath: this.sharedVolumePath},
      {emptyDir: {medium: EMPTY_DIR_VOLUME_SOURCE_MEMORY}},
      'name',
      envVarsByName
    )
    // Let GCR generate the next revision name
    template.revision = undefined
    // Set unified service tag labels
    const updatedLabels: Record<string, string> = {
      ...service.labels,
      service: ddService,
      [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE.replace(/\./g, '_'),
    }
    if (!!this.environment) {
      updatedLabels.env = this.environment
    }
    if (!!this.version) {
      updatedLabels.version = this.version
    }

    return {
      ...service,
      labels: updatedLabels,
      template,
    }
  }
  public getEnvVarsByName(config: ServerlessConfigOptions): Record<string, IEnvVar> {
    // Get base environment variables
    const envVars = getBaseEnvVars(config)

    for (const [name, value] of [
      [DD_TRACE_ENABLED_ENV_VAR, this.tracing],
      [DD_LOG_LEVEL_ENV_VAR, this.logLevel],
      [DD_SOURCE_ENV_VAR, this.language],
    ] as const) {
      if (value) {
        envVars[name] = value
      }
    }

    return Object.fromEntries(Object.entries(envVars).map(([name, value]) => [name, {name, value}]))
  }

  public buildBaseSidecarContainer(existingSidecarContainer: IContainer | undefined): IContainer {
    // We prioritize in this order: CLI flag, existing setup, default
    let healthCheckPort = Number(
      this.healthCheckPort ?? existingSidecarContainer?.env?.find(({name}) => name === HEALTH_PORT_ENV_VAR)?.value
    )
    healthCheckPort = Number.isNaN(healthCheckPort) ? DEFAULT_HEALTH_CHECK_PORT : healthCheckPort

    // Create sidecar container with volume mount and environment variables
    return {
      ...existingSidecarContainer,
      name: this.sidecarName,
      image: this.sidecarImage,
      startupProbe: {
        tcpSocket: {
          port: healthCheckPort,
        },
        initialDelaySeconds: 0,
        periodSeconds: 10,
        failureThreshold: 3,
        timeoutSeconds: 1,
      },
      resources: {
        limits: {
          memory: this.sidecarMemory,
          cpu: this.sidecarCpus,
        },
      },
    }
  }
}
