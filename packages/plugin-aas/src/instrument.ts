import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient, TagsOperations} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {DATADOG_SITE_US1} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/git/source-code-integration'
import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import equal from 'fast-deep-equal/es6'

import {
  AasCommand,
  collectAsyncIterator,
  formatError,
  getEnvVars,
  isDotnet,
  isLinuxContainer,
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
  private logPath = Option.String('--log-path', {
    description: 'Where you write your logs. For example, /home/LogFiles/*.log or /home/LogFiles/myapp/*.log',
  })
  private shouldNotRestart = Option.Boolean('--no-restart', false, {
    description: 'Do not restart the App Service after applying instrumentation.',
  })

  private isDotnet = Option.Boolean('--dotnet', false, {
    description:
      'Add in required .NET-specific configuration options, is automatically inferred for code runtimes. This should be specified if you are using a containerized .NET app.',
  })
  private isMusl = Option.Boolean('--musl', false, {
    description:
      'Add in required .NET-specific configuration options for musl-based .NET apps. This should be specified if you are using a containerized .NET app on a musl-based distribution like Alpine Linux.',
  })

  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Enable source code integration to add git metadata as tags. Defaults to enabled. Specify `--no-source-code-integration` to disable.',
  })

  private uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description: 'Upload git metadata to Datadog. Defaults to enabled. Specify `--no-upload-git-metadata` to disable.',
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
      logPath: this.logPath,
      shouldNotRestart: this.shouldNotRestart,
      isDotnet: this.isDotnet,
      isMusl: this.isMusl,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}

export class PluginCommand extends InstrumentCommand {
  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [appServicesToInstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    try {
      const isApiKeyValid = await newApiKeyValidator({
        apiKey: process.env.DD_API_KEY,
        datadogSite: process.env.DD_SITE ?? DATADOG_SITE_US1,
      }).validateApiKey()
      if (!isApiKeyValid) {
        throw Error()
      }
    } catch (e) {
      this.context.stdout.write(
        renderSoftWarning(
          `Invalid API Key stored in the environment variable ${chalk.bold('DD_API_KEY')}: ${maskString(
            process.env.DD_API_KEY ?? ''
          )}\nEnsure you copied the value and not the Key ID.`
        )
      )

      return 1
    }

    const cred = new DefaultAzureCredential()
    if (!(await this.ensureAzureAuth(cred))) {
      return 1
    }
    const tagClient = new ResourceManagementClient(cred).tagsOperations

    if (config.sourceCodeIntegration) {
      config.extraTags = await handleSourceCodeIntegration(
        this.context,
        config.uploadGitMetadata ?? true,
        config.extraTags
      )
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

      const isContainer = isLinuxContainer(site)
      if (config.isMusl && !isContainer) {
        this.context.stdout.write(
          renderSoftWarning(
            `The --musl flag is set, but the App Service ${chalk.bold(aasName)} is not a containerized app. \
This flag is only applicable for containerized .NET apps (on musl-based distributions like Alpine Linux), and will be ignored.`
          )
        )
      }
      await this.instrumentSidecar(
        aasClient,
        {
          ...config,
          isDotnet: config.isDotnet || isDotnet(site),
          isMusl: config.isMusl && config.isDotnet && isContainer,
        },
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
          // We're allowing access to all env vars since it is simpler
          // and doesn't cause problems, but not all env vars are needed for the sidecar.
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
