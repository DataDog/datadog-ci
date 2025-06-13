import IService = google.cloud.run.v2.IService
import IContainer = google.cloud.run.v2.IContainer
import IVolume = google.cloud.run.v2.IVolume

import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'
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
} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
import {renderSoftWarning} from '../../helpers/renderer'
import {maskString} from '../../helpers/utils'

import {CloudRunConfigOptions} from './interfaces'
import {renderAuthenticationInstructions, renderCloudRunInstrumentUninstrumentHeader, withSpinner} from './renderer'
import {checkAuthentication} from './utils'

export class InstrumentCommand extends Command {
  // TODO uncomment when commnand is ready and add to docs: https://github.com/DataDog/datadog-ci#cloud-run
  public static paths = [['cloud-run', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Cloud Run app.',
  })

  private configPath = Option.String('--config') // todo
  private ddService = Option.String('--dd-service, --ddservice')
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false) // todo
  private environment = Option.String('--env')
  private extraTags = Option.String('--extra-tags,--extraTags') // todo
  private project = Option.String('-p,--project')
  private services = Option.Array('-s,--service,--services', [])
  private interactive = Option.Boolean('-i,--interactive', false) // todo
  private logging = Option.String('--logging') // todo
  private logLevel = Option.String('--log-level,--logLevel') // todo
  private regExPattern = Option.String('--services-regex,--servicesRegex') // todo
  private region = Option.String('-r,--region')
  private sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true) // todo
  private uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true) // todo
  private tracing = Option.String('--tracing') // todo
  private version = Option.String('--version')
  private llmobs = Option.String('--llmobs') // todo

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

    // Verify GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    const authenticated = await checkAuthentication()
    if (!authenticated) {
      this.context.stderr.write(renderAuthenticationInstructions())

      return 1
    }
    this.context.stdout.write('GCP credentials verified!\n')

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
    const ddService = this.ddService ?? process.env[SERVICE_ENV_VAR]
    if (!ddService) {
      this.context.stdout.write(
        chalk.yellow(
          'No DD_SERVICE specified for instrumentation. Please use the DD_SERVICE env var or the --dd-service flag.\n'
        )
      )
    }
    if (!project || !services || !services.length || !region || !ddService) {
      return 1
    }
    this.context.stdout.write(chalk.green('✔ Required flags verified\n'))

    // Instrument services with sidecar
    try {
      await this.instrumentSidecar(project, services, region, ddService)
    } catch (error) {
      return 1
    }

    this.context.stdout.write('\n✅ Cloud Run instrumentation completed successfully!\n')

    return 0
  }

  private async instrumentSidecar(project: string, services: string[], region: string, ddService: string) {
    const client = new ServicesClient()

    this.context.stdout.write(chalk.bold('\n🚀 Instrumenting Cloud Run services with sidecar...\n'))

    for (const service of services) {
      try {
        await this.instrumentService(client, project, service, region, ddService)
      } catch (error) {
        this.context.stderr.write(chalk.red(`Failed to instrument service ${service}: ${error}\n`))
        throw error
      }
    }
  }

  private async instrumentService(
    client: ServicesClient,
    project: string,
    serviceName: string,
    region: string,
    ddService: string
  ) {
    this.context.stdout.write(`Instrumenting service: ${chalk.bold(serviceName)}\n`)

    const servicePath = client.servicePath(project, region, serviceName)

    const service = await withSpinner(
      `Fetching service configuration...`,
      async () => {
        try {
          const [existingService] = await client.getService({name: servicePath})

          return existingService
        } catch (error) {
          throw new Error(`Service ${serviceName} not found in project ${project}, region ${region}`)
        }
      },
      `Fetched service configuration`
    )

    const updatedService = this.createInstrumentedServiceConfig(service, ddService)

    await withSpinner(
      `Updating service ${serviceName}...`,
      async () => {
        const [operation] = await client.updateService({
          service: updatedService,
        })
        await operation.promise()
      },
      `Updated service ${serviceName}`
    )
  }

  private createInstrumentedServiceConfig(service: IService, ddService: string): IService {
    const template = service.template || {}
    const containers: IContainer[] = template.containers || []
    const volumes: IVolume[] = template.volumes || []
    const sidecarName = 'datadog-sidecar'
    const volumeName = 'shared-volume'

    // Check if sidecar already exists
    const existingSidecarIndex = containers.findIndex((c) => c.name === sidecarName)

    // Create sidecar container with volume mount and environment variables
    const sidecarContainer: IContainer = {
      name: sidecarName,
      image: 'gcr.io/datadoghq/serverless-init:latest',
      volumeMounts: [
        {
          name: volumeName,
          mountPath: '/shared-volume',
        },
      ],
      env: [
        {name: SITE_ENV_VAR, value: process.env.DD_SITE || DATADOG_SITE_US1},
        {name: LOGS_PATH_ENV_VAR, value: '/shared-volume/logs/*.log'},
        {name: API_KEY_ENV_VAR, value: process.env.DD_API_KEY},
        {name: HEALTH_PORT_ENV_VAR, value: '12345'},
        {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
        {name: SERVICE_ENV_VAR, value: ddService},
        ...(this.environment ? [{name: ENVIRONMENT_ENV_VAR, value: this.environment}] : []),
        ...(this.version ? [{name: VERSION_ENV_VAR, value: this.version}] : []),
      ],
      startupProbe: {
        tcpSocket: {
          port: 12345,
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

    // Update all containers to add volume mounts if they don't have them
    const updatedContainers = containers.map((container) => {
      if (container.name === sidecarName) {
        return sidecarContainer
      }

      // Add volume mount to main containers if not already present
      const existingVolumeMounts = container.volumeMounts || []
      const hasSharedVolumeMount = existingVolumeMounts.some((mount) => mount.name === volumeName)
      const existingEnvVars = container.env || []

      const updatedContainer = {...container}
      if (!hasSharedVolumeMount) {
        updatedContainer.volumeMounts = [
          ...existingVolumeMounts,
          {
            name: volumeName,
            mountPath: '/shared-volume',
          },
        ]
      }

      // Update environment variables
      const updatedEnvVars = [...existingEnvVars]

      // Replace DD_SERVICE with new value
      const serviceEnvIndex = updatedEnvVars.findIndex((envVar) => envVar.name === SERVICE_ENV_VAR)
      if (serviceEnvIndex >= 0) {
        updatedEnvVars[serviceEnvIndex] = {name: SERVICE_ENV_VAR, value: ddService}
      } else {
        updatedEnvVars.push({name: SERVICE_ENV_VAR, value: ddService})
      }

      // Default to DD_LOGS_INJECTION=true, but don't overwrite existing value
      const hasLogsInjection = updatedEnvVars.some((envVar) => envVar.name === LOGS_INJECTION_ENV_VAR)
      if (!hasLogsInjection) {
        updatedEnvVars.push({name: LOGS_INJECTION_ENV_VAR, value: 'true'})
      }

      updatedContainer.env = updatedEnvVars

      return updatedContainer
    })

    // Add sidecar if it doesn't exist
    if (existingSidecarIndex < 0) {
      updatedContainers.push(sidecarContainer)
    }

    // Add shared volume if it doesn't exist
    const hasSharedVolume = volumes.some((volume) => volume.name === volumeName)
    const updatedVolumes = hasSharedVolume
      ? volumes
      : [
          ...volumes,
          {
            name: volumeName,
            emptyDir: {
              medium: google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY,
            },
          },
        ]

    return {
      ...service,
      template: {
        ...template,
        containers: updatedContainers,
        volumes: updatedVolumes,
      },
    }
  }
}
