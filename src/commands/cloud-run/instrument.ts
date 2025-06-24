import type {IService, IContainer, IVolume, IVolumeMount, ServicesClient as IServicesClient, IEnvVar} from './types'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {
  API_KEY_ENV_VAR,
  DATADOG_SITE_US1,
  ENVIRONMENT_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  LOGS_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  EXTRA_TAGS_ENV_VAR,
} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
import {renderError, renderSoftWarning} from '../../helpers/renderer'
import {maskString} from '../../helpers/utils'

import {CloudRunConfigOptions} from './interfaces'
import {renderAuthenticationInstructions, renderCloudRunInstrumentUninstrumentHeader, withSpinner} from './renderer'
import {checkAuthentication} from './utils'

// XXX temporary workaround for @google-cloud/run ESM/CJS module issues
const {ServicesClient} = require('@google-cloud/run')

// equivalent to google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const EMPTY_DIR_VOLUME_SOURCE_MEMORY = 1

const SIDECAR_NAME = 'datadog-sidecar'
const VOLUME_NAME = 'shared-volume'
const VOLUME_MOUNT_PATH = '/shared-volume'
const DEFAULT_HEALTH_CHECK_PORT = 5555

export class InstrumentCommand extends Command {
  // TODO add to docs: https://github.com/DataDog/datadog-ci#cloud-run
  public static paths = [['cloud-run', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Cloud Run app.',
  })

  private configPath = Option.String('--config') // todo
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false) // todo
  private environment = Option.String('--env')
  private extraTags = Option.String('--extra-tags,--extraTags')
  private project = Option.String('-p,--project')
  private services = Option.Array('-s,--service,--services', [])
  private interactive = Option.Boolean('-i,--interactive', false) // todo
  private logLevel = Option.String('--log-level,--logLevel')
  private regExPattern = Option.String('--services-regex,--servicesRegex') // todo
  private region = Option.String('-r,--region')
  private sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true) // todo
  private uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true) // todo
  private tracing = Option.String('--tracing')
  private version = Option.String('--version')
  private llmobs = Option.String('--llmobs')
  private healthCheckPort = Option.String('--port,--health-check-port,--healthCheckPort')

  private config: CloudRunConfigOptions = {
    services: [],
    tracing: 'true',
    logging: 'true',
  }

  public async execute(): Promise<0 | 1> {
    // TODO FIPS

    this.context.stdout.write(
      chalk.bold(renderCloudRunInstrumentUninstrumentHeader(Object.getPrototypeOf(this), this.dryRun))
    )

    // TODO resolve config from file
    // TODO dry run
    // TODO interactive

    // Verify DD API Key
    const isApiKeyValid = await newApiKeyValidator({
      apiKey: process.env.DD_API_KEY,
      datadogSite: process.env.DD_SITE ?? DATADOG_SITE_US1,
    }).validateApiKey()
    if (!isApiKeyValid) {
      this.context.stdout.write(
        renderSoftWarning(
          `Invalid API Key stored in the environment variable ${chalk.bold('DD_API_KEY')}: ${maskString(
            process.env.DD_API_KEY ?? ''
          )}\nEnsure you copied the value and not the Key ID.`
        )
      )

      return 1
    }

    // Validate required variables
    this.context.stdout.write(chalk.bold('\n🔍 Verifying command flags...\n'))
    const project = this.project ?? this.config.project
    if (!project) {
      this.context.stdout.write(
        chalk.yellow('No project specified for instrumentation. Please use the --project flag.\n')
      )
    }
    const services = this.services.length > 0 ? this.services : this.config.services
    if (services.length === 0) {
      this.context.stdout.write(
        chalk.yellow('No services specified for instrumentation. Please use the --service flag.\n')
      )
    }
    const region = this.region ?? this.config.region
    if (!region) {
      this.context.stdout.write(
        chalk.yellow('No region specified for instrumentation. Please use the --region flag.\n')
      )
    }

    const ddService = process.env[SERVICE_ENV_VAR]
    if (!ddService) {
      this.context.stdout.write(renderSoftWarning('No DD_SERVICE env var found. Will default to the service name.'))
    }

    if (this.extraTags && !this.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      this.context.stderr.write(renderError('Extra tags do not comply with the <key>:<value> array.\n'))

      return 1
    }

    if (!project || !services || !services.length || !region) {
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
    this.context.stdout.write(chalk.green('✔ GCP credentials verified!\n'))

    // Instrument services with sidecar
    try {
      await this.instrumentSidecar(project, services, region, ddService)
    } catch (error) {
      this.context.stderr.write(chalk.red(`\nInstrumentation failed: ${error}`))

      return 1
    }

    this.context.stdout.write('\n✅ Cloud Run instrumentation completed successfully!\n')

    return 0
  }

  public async instrumentSidecar(project: string, services: string[], region: string, ddService: string | undefined) {
    const client: IServicesClient = new ServicesClient()

    this.context.stdout.write(chalk.bold('\n⬇️ Fetching existing service configurations from Cloud Run...\n'))

    const existingServiceConfigs: IService[] = []
    for (const serviceName of services) {
      const servicePath = client.servicePath(project, region, serviceName)

      const existingService = await withSpinner(
        `Fetching configuration for ${chalk.bold(serviceName)}...`,
        async () => {
          try {
            const [serv] = await client.getService({name: servicePath})

            return serv
          } catch (error) {
            throw new Error(
              `Service ${serviceName} not found in project ${project}, region ${region}.\n\nNo services were instrumented.\n`
            )
          }
        },
        `Fetched service configuration for ${chalk.bold(serviceName)}`
      )
      existingServiceConfigs.push(existingService)
    }

    this.context.stdout.write(chalk.bold('\n🚀 Instrumenting Cloud Run services with sidecar...\n'))
    for (let i = 0; i < existingServiceConfigs.length; i++) {
      const serviceConfig = existingServiceConfigs[i]
      const serviceName = services[i]
      try {
        const actualDDService = ddService ?? serviceName
        await this.instrumentService(client, serviceConfig, serviceName, actualDDService)
      } catch (error) {
        this.context.stderr.write(chalk.red(`Failed to instrument service ${serviceName}: ${error}\n`))
        throw error
      }
    }
  }

  public async instrumentService(
    client: IServicesClient,
    existingService: IService,
    serviceName: string,
    ddService: string
  ) {
    const updatedService = this.createInstrumentedServiceConfig(existingService, ddService)

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
    const template = service.template || {}
    const containers: IContainer[] = template.containers || []
    const volumes: IVolume[] = template.volumes || []

    const existingSidecarContainer = containers.find((c) => c.name === SIDECAR_NAME)
    const newSidecarContainer = this.buildSidecarContainer(existingSidecarContainer, ddService)

    // Update all app containers to add volume mounts and env vars if they don't have them
    const updatedContainers = containers.map((container) => {
      if (container.name === SIDECAR_NAME) {
        return newSidecarContainer
      }

      return this.updateAppContainer(container, ddService)
    })

    // Add sidecar if it doesn't exist
    if (!existingSidecarContainer) {
      updatedContainers.push(newSidecarContainer)
    }

    // Add shared volume if it doesn't exist
    const hasSharedVolume = volumes.some((volume) => volume.name === VOLUME_NAME)
    const updatedVolumes = hasSharedVolume
      ? volumes
      : [
          ...volumes,
          {
            name: VOLUME_NAME,
            emptyDir: {
              medium: EMPTY_DIR_VOLUME_SOURCE_MEMORY,
            },
          },
        ]

    return {
      ...service,
      template: {
        ...template,
        containers: updatedContainers,
        volumes: updatedVolumes,
        // Let GCR generate the next revision name
        revision: undefined,
      },
    }
  }

  public buildSidecarContainer(existingSidecarContainer: IContainer | undefined, ddService: string): IContainer {
    // Add these env vars to the container if they don't already exist,
    // but leave them unchanged if they already exist on the container.
    const defaultEnvVars: IEnvVar[] = [
      {name: SITE_ENV_VAR, value: DATADOG_SITE_US1},
      {name: LOGS_PATH_ENV_VAR, value: `${VOLUME_MOUNT_PATH}/logs/*.log`}, // TODO make configurable
      {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
      {name: TRACE_ENABLED_ENV_VAR, value: 'true'},
      {name: HEALTH_PORT_ENV_VAR, value: DEFAULT_HEALTH_CHECK_PORT.toString()},
    ]

    // Overwrite existing env vars with these if they already exist,
    // and add them to the container if they don't exist yet.
    const replacedEnvVars: IEnvVar[] = [
      {name: API_KEY_ENV_VAR, value: process.env.DD_API_KEY},
      {name: SERVICE_ENV_VAR, value: ddService},
    ]
    if (process.env.DD_SITE) {
      replacedEnvVars.push({name: SITE_ENV_VAR, value: process.env.DD_SITE})
    }
    if (this.tracing) {
      replacedEnvVars.push({name: TRACE_ENABLED_ENV_VAR, value: this.tracing})
    }
    if (this.environment) {
      replacedEnvVars.push({name: ENVIRONMENT_ENV_VAR, value: this.environment})
    }
    if (this.version) {
      replacedEnvVars.push({name: VERSION_ENV_VAR, value: this.version})
    }
    if (this.logLevel) {
      replacedEnvVars.push({name: LOG_LEVEL_ENV_VAR, value: this.logLevel})
    }
    if (this.extraTags) {
      replacedEnvVars.push({name: EXTRA_TAGS_ENV_VAR, value: this.extraTags})
    }

    // If port is specified, overwrite any existing value
    // If port is not specified but already exists, leave existing value unchanged
    // If port is not specified and does not exist, default to 5555
    let healthCheckPort =
      existingSidecarContainer?.env?.find((envVar) => envVar.name === HEALTH_PORT_ENV_VAR) ?? DEFAULT_HEALTH_CHECK_PORT
    if (this.healthCheckPort) {
      const newHealthCheckPort = Number(this.healthCheckPort)
      if (!Number.isNaN(newHealthCheckPort)) {
        healthCheckPort = newHealthCheckPort
        replacedEnvVars.push({name: HEALTH_PORT_ENV_VAR, value: healthCheckPort.toString()})
      }
    }

    const newEnv: IEnvVar[] = existingSidecarContainer?.env ?? []
    // Overwrite all replacedEnvVars, or add if they don't exist yet
    for (const replacedEnvVar of replacedEnvVars) {
      const existingEnvVar = newEnv.find((c) => c.name === replacedEnvVar.name)
      if (existingEnvVar) {
        existingEnvVar.value = replacedEnvVar.value
      } else {
        newEnv.push(replacedEnvVar)
      }
    }
    // Add all defaultEnvVars if they don't exist yet, but don't overwrite existing values
    for (const defaultEnvVar of defaultEnvVars) {
      if (newEnv.some((envVar) => envVar.name === defaultEnvVar.name)) {
        continue
      }
      newEnv.push(defaultEnvVar)
    }

    // Create sidecar container with volume mount and environment variables
    return {
      name: SIDECAR_NAME,
      image: 'gcr.io/datadoghq/serverless-init:latest', // TODO make configurable
      volumeMounts: [
        {
          name: VOLUME_NAME,
          mountPath: VOLUME_MOUNT_PATH,
        },
      ],
      env: newEnv,
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
          memory: '512Mi',
          cpu: '1',
        },
      },
    }
  }

  // Add volume mount and update required env vars
  private updateAppContainer(appContainer: IContainer, ddService: string) {
    const existingVolumeMounts = appContainer.volumeMounts || []
    const hasSharedVolumeMount = existingVolumeMounts.some((mount: IVolumeMount) => mount.name === VOLUME_NAME)
    const existingEnvVars = appContainer.env || []

    const updatedContainer = {...appContainer}
    if (!hasSharedVolumeMount) {
      updatedContainer.volumeMounts = [
        ...existingVolumeMounts,
        {
          name: VOLUME_NAME,
          mountPath: VOLUME_MOUNT_PATH,
        },
      ]
    }

    // Update environment variables
    const updatedEnvVars = [...existingEnvVars]

    // Default to DD_LOGS_INJECTION=true, but don't overwrite existing value
    const hasLogsInjection = updatedEnvVars.some((envVar) => envVar.name === LOGS_INJECTION_ENV_VAR)
    if (!hasLogsInjection) {
      updatedEnvVars.push({name: LOGS_INJECTION_ENV_VAR, value: 'true'})
    }

    // Replace DD_SERVICE
    this.addOrReplaceEnvVar(updatedEnvVars, SERVICE_ENV_VAR, ddService)

    // Replace DD_API_KEY
    this.addOrReplaceEnvVar(updatedEnvVars, API_KEY_ENV_VAR, process.env.DD_API_KEY ?? '')

    // Replace LLMOBS env vars
    if (this.llmobs) {
      this.addOrReplaceEnvVar(updatedEnvVars, DD_LLMOBS_ENABLED_ENV_VAR, 'true')
      this.addOrReplaceEnvVar(updatedEnvVars, DD_LLMOBS_ML_APP_ENV_VAR, this.llmobs)
      // serverless-init is installed, so agentless mode should be false
      this.addOrReplaceEnvVar(updatedEnvVars, DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR, 'false')
    }

    updatedContainer.env = updatedEnvVars

    return updatedContainer
  }

  private addOrReplaceEnvVar(envVars: IEnvVar[], name: string, value: string) {
    const envVarIndex = envVars.findIndex((envVar) => envVar.name === name)
    if (envVarIndex >= 0) {
      envVars[envVarIndex] = {name, value}
    } else {
      envVars.push({name, value})
    }
  }
}
