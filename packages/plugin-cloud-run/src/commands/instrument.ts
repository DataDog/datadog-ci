import type {IEnvVar, IService} from '../types'
import type {ServerlessConfigOptions} from '@datadog/datadog-ci-base/helpers/serverless/common'

import {CloudRunInstrumentCommand} from '@datadog/datadog-ci-base/commands/cloud-run/instrument'
import {DATADOG_SITE_US1, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff, getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DD_LOG_LEVEL_ENV_VAR,
  DD_SOURCE_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  SERVICE_ENV_VAR,
  CI_SITE_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {TRACER_COPY_CONTAINER_NAME} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import {RevisionsClient, ServicesClient} from '@google-cloud/run'
import chalk from 'chalk'

import {requestGCPProject, requestGCPRegion, requestServiceName, requestSite, requestConfirmation} from '../prompt'
import {dryRunPrefix, renderAuthenticationInstructions, withSpinner} from '../renderer'
import {instrumentServiceConfig} from '../service-config'
import {checkAuthentication, fetchServiceConfigs} from '../utils'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }

  return value
}

const servicesAreEqual = (left: IService, right: IService): boolean => {
  const withoutRevision = (service: IService): IService => ({
    ...service,
    template: service.template ? {...service.template, revision: undefined} : service.template,
  })

  return JSON.stringify(canonicalize(withoutRevision(left))) === JSON.stringify(canonicalize(withoutRevision(right)))
}

const parseServiceName = (name: string | undefined) => {
  const match = name?.match(/^projects\/([^/]+)\/locations\/([^/]+)\/services\/([^/]+)$/)

  return match ? {project: match[1], region: match[2], service: match[3]} : undefined
}

const shortRevisionName = (name: string) => name.split('/').pop() ?? name

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
    const site = getDatadogSite()
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

    const ddService = this.serviceTag ?? process.env[SERVICE_ENV_VAR]
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
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(dryRunPrefix(this.dryRun) + renderError(`Instrumentation failed: ${message}\n`))

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
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to instrument service ${serviceName}: ${message}`)
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
    if (servicesAreEqual(existingService, updatedService)) {
      this.context.stdout.write(
        chalk.green(`✔ Service ${chalk.bold(serviceName)} is already instrumented; no changes needed.\n`)
      )

      return
    }

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

    try {
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
    } catch (error) {
      await this.diagnoseLatestRevision(client, updatedService, serviceName)
      throw error
    }
  }

  public createInstrumentedServiceConfig(service: IService, ddService: string): IService {
    return instrumentServiceConfig(service, {
      ddService,
      environment: this.environment,
      version: this.version,
      envVarsByName: this.getEnvVarsByName({
        service: ddService,
        environment: this.environment,
        version: this.version,
        logPath: this.logsPath,
        extraTags: this.extraTags,
        envVars: this.envVars,
      }),
      healthCheckPort: this.healthCheckPort,
      sidecarName: this.sidecarName,
      sidecarImage: this.sidecarImage,
      sidecarCpus: this.sidecarCpus,
      sidecarMemory: this.sidecarMemory,
      sharedVolumeName: this.sharedVolumeName,
      sharedVolumePath: this.sharedVolumePath,
    })
  }

  public getEnvVarsByName(config: ServerlessConfigOptions): Record<string, IEnvVar> {
    const envVars = getBaseEnvVars(config)

    for (const [name, value] of [
      [DD_TRACE_ENABLED_ENV_VAR, this.tracing],
      [DD_LOG_LEVEL_ENV_VAR, this.logLevel],
      [DD_SOURCE_ENV_VAR, this.language],
      ...(this.llmobs
        ? [
            [DD_LLMOBS_ENABLED_ENV_VAR, 'true'],
            [DD_LLMOBS_ML_APP_ENV_VAR, this.llmobs],
            // serverless-init is installed, so agentless mode should be false
            [DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR, 'false'],
          ]
        : []),
    ] as const) {
      if (value) {
        envVars[name] = value
      }
    }

    return Object.fromEntries(Object.entries(envVars).map(([name, value]) => [name, {name, value}]))
  }

  private async diagnoseLatestRevision(client: ServicesClient, service: IService, serviceName: string): Promise<void> {
    const hasTracerContainer = service.template?.containers?.some(
      (container) => container.name === TRACER_COPY_CONTAINER_NAME
    )
    if (!hasTracerContainer) {
      return
    }

    const parsedName = parseServiceName(service.name || undefined)
    const project = parsedName?.project ?? this.project
    const region = parsedName?.region ?? this.region
    const shortServiceName = parsedName?.service ?? serviceName
    let revisionName: string | undefined

    this.context.stderr.write(chalk.yellow('\nDiagnosing the latest Cloud Run revision...\n'))
    try {
      if (!service.name) {
        throw new Error('The service resource name is unavailable.')
      }

      const [latestService] = await client.getService({name: service.name})
      revisionName = latestService.latestCreatedRevision || undefined
      if (!revisionName) {
        throw new Error('Cloud Run did not report a latest created revision.')
      }

      const [revision] = await new RevisionsClient().getRevision({name: revisionName})
      this.context.stderr.write(`Latest revision: ${revisionName}\n`)
      if (revision.conditions?.length) {
        this.context.stderr.write('Conditions:\n')
        for (const condition of revision.conditions) {
          const reason = condition.revisionReason ?? condition.reason
          const hasState = typeof condition.state === 'number' || typeof condition.state === 'string'
          const hasReason = typeof reason === 'number' || typeof reason === 'string'
          const details = [
            condition.type || 'Unknown',
            hasState ? `state=${condition.state}` : undefined,
            hasReason ? `reason=${reason}` : undefined,
            condition.message || undefined,
          ].filter((detail): detail is string => detail !== undefined)
          this.context.stderr.write(`  - ${details.join(': ')}\n`)
        }
      } else {
        this.context.stderr.write('Conditions: none reported\n')
      }
      if (revision.logUri) {
        this.context.stderr.write(`Logs: ${revision.logUri}\n`)
      }
    } catch (diagnosticError) {
      const message = diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
      this.context.stderr.write(chalk.yellow(`Unable to read the latest revision details: ${message}\n`))
    }

    if (project && region) {
      const revision = revisionName ? shortRevisionName(revisionName) : undefined
      const describeCommand = revision
        ? `gcloud run revisions describe ${revision} --project ${project} --region ${region}`
        : `gcloud run services describe ${shortServiceName} --project ${project} --region ${region}`
      const logFilter = revision
        ? `resource.labels.revision_name="${revision}"`
        : `resource.labels.service_name="${shortServiceName}"`
      this.context.stderr.write(
        `Fallback commands:\n  ${describeCommand}\n  gcloud logging read 'resource.type="cloud_run_revision" AND ${logFilter}' --project ${project} --limit 50\n`
      )
    }
  }
}
