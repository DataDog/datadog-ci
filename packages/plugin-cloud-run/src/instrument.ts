import type {IContainer, IEnvVar, IService, IVolume, IVolumeMount, ServicesClient as IServicesClient} from './types'

import {
  API_KEY_ENV_VAR,
  DATADOG_SITE_US1,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  HEALTH_PORT_ENV_VAR,
  DD_LOG_LEVEL_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  LOGS_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
  CI_SITE_ENV_VAR,
  FIPS_ENV_VAR,
  FIPS_IGNORE_ERROR_ENV_VAR,
  DD_SOURCE_ENV_VAR,
} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/git/source-code-integration'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from './constants'
import {requestGCPProject, requestGCPRegion, requestServiceName, requestSite, requestConfirmation} from './prompt'
import {dryRunPrefix, renderAuthenticationInstructions, withSpinner} from './renderer'
import {checkAuthentication, fetchServiceConfigs, generateConfigDiff} from './utils'

// XXX temporary workaround for @google-cloud/run ESM/CJS module issues
const {ServicesClient} = require('@google-cloud/run')

// equivalent to google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const EMPTY_DIR_VOLUME_SOURCE_MEMORY = 1

const DEFAULT_VOLUME_PATH = '/shared-volume'
const DEFAULT_LOGS_PATH = '/shared-volume/logs/*.log'
const DEFAULT_HEALTH_CHECK_PORT = 5555
const DEFAULT_SIDECAR_IMAGE = 'gcr.io/datadoghq/serverless-init:latest'

const DEFAULT_ENV_VARS: IEnvVar[] = [
  {name: SITE_ENV_VAR, value: DATADOG_SITE_US1},
  {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
  {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
  {name: HEALTH_PORT_ENV_VAR, value: DEFAULT_HEALTH_CHECK_PORT.toString()},
]

export class InstrumentCommand extends Command {
  public static paths = [['cloud-run', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Cloud Run app.',
  })

  // private configPath = Option.String('--config') implement if requested by customers
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private environment = Option.String('--env')
  private extraTags = Option.String('--extra-tags,--extraTags')
  private project = Option.String('-p,--project', {
    description: 'GCP project ID',
  })
  private services = Option.Array('-s,--service,--services', [], {
    description: 'Cloud Run service(s) to instrument',
  })
  private interactive = Option.Boolean('-i,--interactive', false, {
    description: 'Prompt for flags one at a time',
  })
  private region = Option.String('-r,--region', {
    description: 'GCP region your service(s) are deployed in',
  })
  private logLevel = Option.String('--log-level,--logLevel')
  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Enable source code integration to add git metadata as tags. Defaults to enabled. Specify `--no-source-code-integration` to disable.',
  })
  private uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description: 'Upload git metadata to Datadog. Defaults to enabled. Specify `--no-upload-git-metadata` to disable.',
  })
  private tracing = Option.String('--tracing')
  private version = Option.String('--version')
  private llmobs = Option.String('--llmobs')
  private healthCheckPort = Option.String('--port,--health-check-port,--healthCheckPort')
  private sidecarImage = Option.String('--image,--sidecar-image', DEFAULT_SIDECAR_IMAGE, {
    description: `The image to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_IMAGE}'`,
  })
  private sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `(Not recommended) The name to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  private sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `(Not recommended) The name to use for the shared volume. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  private sharedVolumePath = Option.String('--shared-volume-path', DEFAULT_VOLUME_PATH, {
    description: `(Not recommended) The path to use for the shared volume. Defaults to '${DEFAULT_VOLUME_PATH}'`,
  })
  private logsPath = Option.String('--logs-path', DEFAULT_LOGS_PATH, {
    description: `(Not recommended) The path to use for the logs. Defaults to '${DEFAULT_LOGS_PATH}'. Must begin with the shared volume path.`,
  })
  private sidecarCpus = Option.String('--sidecar-cpus', '1', {
    description: `The number of CPUs to allocate to the sidecar container. Defaults to 1.`,
  })
  private sidecarMemory = Option.String('--sidecar-memory', '512Mi', {
    description: `The amount of memory to allocate to the sidecar container. Defaults to '512Mi'.`,
  })
  private language = Option.String('--language', {
    description: `Set the language used in your container or function for advanced log parsing. Sets the DD_SOURCE env var. Possible values: "nodejs", "python", "go", "java", "csharp", "ruby", or "php".`,
  })
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private fipsConfig = {
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
    const client: IServicesClient = new ServicesClient()

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
    client: IServicesClient,
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
    const template = service.template || {}
    const containers: IContainer[] = template.containers || []
    const volumes: IVolume[] = template.volumes || []

    const existingSidecarContainer = containers.find((c) => c.name === this.sidecarName)
    const newSidecarContainer = this.buildSidecarContainer(existingSidecarContainer, ddService)

    // Update all app containers to add volume mounts and env vars if they don't have them
    const updatedContainers = containers.map((container) => {
      if (container.name === this.sidecarName) {
        return newSidecarContainer
      }

      return this.updateAppContainer(container, ddService)
    })

    // Add sidecar if it doesn't exist
    if (!existingSidecarContainer) {
      updatedContainers.push(newSidecarContainer)
    }

    // Add shared volume if it doesn't exist
    const hasSharedVolume = volumes.some((volume) => volume.name === this.sharedVolumeName)
    const updatedVolumes = hasSharedVolume
      ? volumes
      : [
          ...volumes,
          {
            name: this.sharedVolumeName,
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
    const newEnvVars: Record<string, string> = {}
    for (const envVar of existingSidecarContainer?.env ?? []) {
      newEnvVars[envVar.name] = envVar.value
    }

    // Add these env vars to the container if they don't already exist,
    // but leave them unchanged if they already exist in the container.
    for (const {name, value} of DEFAULT_ENV_VARS) {
      if (!(name in newEnvVars)) {
        newEnvVars[name] = value
      }
    }

    // Overwrite existing env vars with these if they already exist
    // and add them to the container if they don't exist yet.
    newEnvVars[API_KEY_ENV_VAR] = process.env[API_KEY_ENV_VAR] ?? ''
    newEnvVars[SERVICE_ENV_VAR] = ddService
    if (process.env[SITE_ENV_VAR]) {
      newEnvVars[SITE_ENV_VAR] = process.env[SITE_ENV_VAR]
    }
    if (this.tracing) {
      newEnvVars[DD_TRACE_ENABLED_ENV_VAR] = this.tracing
    }
    if (this.environment) {
      newEnvVars[ENVIRONMENT_ENV_VAR] = this.environment
    }
    if (this.version) {
      newEnvVars[VERSION_ENV_VAR] = this.version
    }
    if (this.logLevel) {
      newEnvVars[DD_LOG_LEVEL_ENV_VAR] = this.logLevel
    }
    if (this.extraTags) {
      newEnvVars[DD_TAGS_ENV_VAR] = this.extraTags
    }
    if (this.language) {
      newEnvVars[DD_SOURCE_ENV_VAR] = this.language
    }
    newEnvVars[LOGS_PATH_ENV_VAR] = this.logsPath

    // If port is specified, overwrite any existing value
    // If port is not specified but already exists, leave the existing value unchanged
    // If port is not specified and does not exist, default to 5555
    let healthCheckPort = newEnvVars[HEALTH_PORT_ENV_VAR] ?? DEFAULT_HEALTH_CHECK_PORT.toString()
    if (this.healthCheckPort) {
      const newHealthCheckPort = Number(this.healthCheckPort)
      if (!Number.isNaN(newHealthCheckPort)) {
        healthCheckPort = newHealthCheckPort.toString()
        newEnvVars[HEALTH_PORT_ENV_VAR] = healthCheckPort
      }
    }

    const newEnv: IEnvVar[] = Object.entries(newEnvVars).map(([name, value]) => ({name, value}))

    // Create sidecar container with volume mount and environment variables
    return {
      name: this.sidecarName,
      image: this.sidecarImage,
      volumeMounts: [
        {
          name: this.sharedVolumeName,
          mountPath: this.sharedVolumePath,
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
          memory: this.sidecarMemory,
          cpu: this.sidecarCpus,
        },
      },
    }
  }

  // Add volume mount and update required env vars
  private updateAppContainer(appContainer: IContainer, ddService: string) {
    const existingVolumeMounts = appContainer.volumeMounts || []
    const hasSharedVolumeMount = existingVolumeMounts.some(
      (mount: IVolumeMount) => mount.name === this.sharedVolumeName
    )
    const existingEnvVars = appContainer.env || []

    const updatedContainer = {...appContainer}
    if (!hasSharedVolumeMount) {
      updatedContainer.volumeMounts = [
        ...existingVolumeMounts,
        {
          name: this.sharedVolumeName,
          mountPath: this.sharedVolumePath,
        },
      ]
    }

    // Update environment variables
    const newEnvVars: Record<string, string> = {}
    for (const {name, value} of existingEnvVars) {
      newEnvVars[name] = value
    }

    // Default to DD_LOGS_INJECTION=true, but don't overwrite existing value
    if (!(LOGS_INJECTION_ENV_VAR in newEnvVars)) {
      newEnvVars[LOGS_INJECTION_ENV_VAR] = 'true'
    }

    // Replace or add other env vars
    newEnvVars[SERVICE_ENV_VAR] = ddService
    newEnvVars[API_KEY_ENV_VAR] = process.env[API_KEY_ENV_VAR] ?? ''
    newEnvVars[LOGS_PATH_ENV_VAR] = this.logsPath
    if (this.llmobs) {
      newEnvVars[DD_LLMOBS_ENABLED_ENV_VAR] = 'true'
      newEnvVars[DD_LLMOBS_ML_APP_ENV_VAR] = this.llmobs
      // serverless-init is installed, so agentless mode should be false
      newEnvVars[DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR] = 'false'
    }

    updatedContainer.env = Object.entries(newEnvVars).map(([name, value]) => ({name, value}))

    return updatedContainer
  }
}
