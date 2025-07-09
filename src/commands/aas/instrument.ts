import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient, TagsOperations} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import equal from 'fast-deep-equal/es6'

import {DATADOG_SITE_US1, EXTRA_TAGS_REG_EXP} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
import {getGitData, uploadGitData} from '../../helpers/git/instrument-helpers'
import {renderError, renderSoftWarning} from '../../helpers/renderer'
import {maskString} from '../../helpers/utils'

import {
  AasCommand,
  collectAsyncIterator,
  formatError,
  getEnvVars,
  isDotnet,
  SIDECAR_CONTAINER_NAME,
  SIDECAR_IMAGE,
  SIDECAR_PORT,
} from './common'
import {AasConfigOptions} from './interfaces'

export class InstrumentCommand extends AasCommand {
  public static paths = [['aas', 'instrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Azure App Service.',
  })

  private service = Option.String('--service', {
    description: 'The value for the service tag. For example, `my-service`',
  })
  private environment = Option.String('--env,--environment', {
    description: 'The value for the env tag. For example, `prod`',
  })
  private version = Option.String('--version', {
    description: 'The value for the version tag. For example, `1.0.0`',
  })
  private isInstanceLoggingEnabled = Option.Boolean('--instance-logging', false, {
    description:
      'When enabled, log collection is automatically configured for an additional file path: /home/LogFiles/*$COMPUTERNAME*.log',
  })
  private isProfilingEnabled = Option.Boolean('--profiling', true, {
    description:
      'Adds the `DD_PROFILING_ENABLED` env var for automatic profiling support. Defaults to enabled. Specify `--no-profiling` to disable.',
  })
  private logPath = Option.String('--log-path', {
    description: 'Where you write your logs. For example, /home/LogFiles/*.log or /home/LogFiles/myapp/*.log',
  })
  private envVars = Option.Array('--env-vars', {
    description:
      'Additional environment variables to set for the App Service. Can specify multiple in the form `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })
  private shouldNotRestart = Option.Boolean('--no-restart', false, {
    description: 'Do not restart the App Service after applying instrumentation.',
  })

  private isDotnet = Option.Boolean('--dotnet', false, {
    description:
      'Add in required .NET-specific configuration options, is automatically inferred for code runtimes. This should be specified if you are using a containerized .NET app.',
  })

  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description: 'Enable source code integration to add git metadata as tags. Defaults to enabled.',
  })

  private uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true, {
    description: 'Upload git metadata to Datadog. Defaults to enabled.',
  })

  private extraTags = Option.String('--extra-tags,--extraTags', {
    description: 'Additional tags to add to the service in the format "key1:value1,key2:value2"',
  })

  public get additionalConfig(): Partial<AasConfigOptions> {
    return {
      service: this.service,
      environment: this.environment,
      version: this.version,
      isInstanceLoggingEnabled: this.isInstanceLoggingEnabled,
      isProfilingEnabled: this.isProfilingEnabled,
      logPath: this.logPath,
      envVars: this.envVars,
      shouldNotRestart: this.shouldNotRestart,
      isDotnet: this.isDotnet,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
    }
  }

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [appServicesToInstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }
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

    if (config.extraTags && !config.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      this.context.stderr.write(renderError('Extra tags do not comply with the <key>:<value> array.\n'))

      return 1
    }

    const cred = new DefaultAzureCredential()
    if (!(await this.ensureAzureAuth(cred))) {
      return 1
    }
    const tagClient = new ResourceManagementClient(cred).tagsOperations

    // Source code integration
    if (config.sourceCodeIntegration) {
      try {
        const gitData = await getGitData()
        if (config.uploadGitMetadata) {
          await uploadGitData(this.context)
        }
        if (config.extraTags) {
          config.extraTags += `,git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
        } else {
          config.extraTags = `git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
        }
      } catch (err) {
        this.context.stdout.write(
          renderSoftWarning(`Couldn't add source code integration, continuing without it. ${err}`)
        )
      }
    }

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning instrumentation of Azure App Service(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToInstrument).map(([subscriptionId, resourceGroupToNames]) =>
        this.processSubscription(cred, tagClient, subscriptionId, resourceGroupToNames, config)
      )
    )
    const success = results.every((result) => result)
    this.context.stdout.write(
      `${this.dryRunPrefix}🐶 Instrumentation completed ${
        success ? 'successfully!' : 'with errors, see above for details.'
      }\n`
    )

    return success ? 0 : 1
  }

  public async processSubscription(
    cred: DefaultAzureCredential,
    tagClient: TagsOperations,
    subscriptionId: string,
    resourceGroupToNames: Record<string, string[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const aasClient = new WebSiteManagementClient(cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, aasNames]) =>
        aasNames.map((aasName) => this.processAas(aasClient, tagClient, config, subscriptionId, resourceGroup, aasName))
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Azure App Service for instrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processAas(
    aasClient: WebSiteManagementClient,
    tagClient: TagsOperations,
    config: AasConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    aasName: string
  ): Promise<boolean> {
    try {
      const site = await aasClient.webApps.get(resourceGroup, aasName)
      if (!this.ensureLinux(site)) {
        return false
      }

      await this.instrumentSidecar(
        aasClient,
        {...config, isDotnet: config.isDotnet || isDotnet(site)},
        resourceGroup,
        aasName
      )
      await this.addTags(tagClient, config, subscriptionId, resourceGroup, aasName, site.tags ?? {})
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to instrument ${aasName}: ${formatError(error)}`))

      return false
    }

    if (!config.shouldNotRestart) {
      this.context.stdout.write(`${this.dryRunPrefix}Restarting Azure App Service ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        try {
          await aasClient.webApps.restart(resourceGroup, aasName)
        } catch (error) {
          this.context.stdout.write(renderError(`Failed to restart Azure App Service ${chalk.bold(aasName)}: ${error}`))

          return false
        }
      }
    }

    return true
  }
  public async addTags(
    tagClient: TagsOperations,
    config: AasConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    aasName: string,
    tags: Record<string, string>
  ): Promise<void> {
    const updatedTags = {...tags}
    if (config.service) {
      updatedTags.service = config.service
    }
    if (config.environment) {
      updatedTags.env = config.environment
    }
    if (config.version) {
      updatedTags.version = config.version
    }
    if (!equal(tags, updatedTags)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating tags for ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        try {
          await tagClient.beginCreateOrUpdateAtScopeAndWait(
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${aasName}`,
            {properties: {tags: updatedTags}}
          )
        } catch (error) {
          this.context.stdout.write(
            renderError(`Failed to update tags for ${chalk.bold(aasName)}: ${formatError(error)}`)
          )
        }
      }
    }
  }

  public async instrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ) {
    const siteContainers = await collectAsyncIterator(client.webApps.listSiteContainers(resourceGroup, aasName))
    const sidecarContainer = siteContainers.find((c) => c.name === SIDECAR_CONTAINER_NAME)
    const envVars = getEnvVars(config)
    // We need to ensure that the sidecar container is configured correctly, which means checking the image, target port,
    // and environment variables. The sidecar environment variables must have matching names and values, as the sidecar
    // env values point to env keys in the main App Settings. (essentially env var forwarding)
    if (
      sidecarContainer === undefined ||
      sidecarContainer.image !== SIDECAR_IMAGE ||
      sidecarContainer.targetPort !== SIDECAR_PORT ||
      !sidecarContainer.environmentVariables?.every(({name, value}) => name === value) ||
      !equal(new Set(sidecarContainer.environmentVariables.map(({name}) => name)), new Set(Object.keys(envVars)))
    ) {
      this.context.stdout.write(
        `${this.dryRunPrefix}${sidecarContainer === undefined ? 'Creating' : 'Updating'} sidecar container ${chalk.bold(
          SIDECAR_CONTAINER_NAME
        )} on ${chalk.bold(aasName)}\n`
      )
      if (!this.dryRun) {
        await client.webApps.createOrUpdateSiteContainer(resourceGroup, aasName, SIDECAR_CONTAINER_NAME, {
          image: SIDECAR_IMAGE,
          targetPort: SIDECAR_PORT,
          isMain: false,
          environmentVariables: Object.keys(envVars).map((name) => ({name, value: name})),
        })
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}Sidecar container ${chalk.bold(
          SIDECAR_CONTAINER_NAME
        )} already exists with correct configuration.\n`
      )
    }
    const existingEnvVars = await client.webApps.listApplicationSettings(resourceGroup, aasName)
    const updatedEnvVars: StringDictionary = {properties: {...existingEnvVars.properties, ...envVars}}
    if (!equal(existingEnvVars.properties, updatedEnvVars.properties)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings for ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        await client.webApps.updateApplicationSettings(resourceGroup, aasName, updatedEnvVars)
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}No Application Settings changes needed for ${chalk.bold(aasName)}.\n`
      )
    }
  }
}
