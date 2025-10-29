import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient, TagsOperations} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {AasConfigOptions} from '@datadog/datadog-ci-base/commands/aas/common'
import {AasInstrumentCommand} from '@datadog/datadog-ci-base/commands/aas/instrument'
import {DATADOG_SITE_US1} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/git/source-code-integration'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {
  collectAsyncIterator,
  ensureAzureAuth,
  formatError,
  SIDECAR_CONTAINER_NAME,
  SIDECAR_IMAGE,
  SIDECAR_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import equal from 'fast-deep-equal/es6'

import {ensureLinux, getEnvVars, isDotnet, isLinuxContainer} from '../common'

export class PluginCommand extends AasInstrumentCommand {
  private cred!: DefaultAzureCredential
  private tagClient!: TagsOperations

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

    this.cred = new DefaultAzureCredential()
    if (!(await ensureAzureAuth((msg) => this.context.stdout.write(msg), this.cred))) {
      return 1
    }
    this.tagClient = new ResourceManagementClient(this.cred).tagsOperations

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
        this.processSubscription(subscriptionId, resourceGroupToNames, config)
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
    subscriptionId: string,
    resourceGroupToNames: Record<string, string[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const aasClient = new WebSiteManagementClient(this.cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, aasNames]) =>
        aasNames.map((aasName) => this.processAas(aasClient, config, resourceGroup, aasName))
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
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ): Promise<boolean> {
    try {
      const site = await aasClient.webApps.get(resourceGroup, aasName)
      if (!ensureLinux((msg) => this.context.stdout.write(msg), site)) {
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
      config = {
        ...config,
        isDotnet: config.isDotnet || isDotnet(site),
        isMusl: config.isMusl && config.isDotnet && isContainer,
        service: config.service ?? aasName,
      }
      await this.instrumentSidecar(aasClient, config, resourceGroup, aasName, isContainer)
      await this.addTags(config, aasClient.subscriptionId!, resourceGroup, aasName, site.tags ?? {})
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
    config: AasConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    aasName: string,
    tags: Record<string, string>
  ): Promise<void> {
    const updatedTags: Record<string, string> = {
      ...tags,
      service: config.service!,
      [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE,
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
          await this.tagClient.beginCreateOrUpdateAtScopeAndWait(
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
    aasName: string,
    isContainer: boolean
  ) {
    const siteContainers = await collectAsyncIterator(client.webApps.listSiteContainers(resourceGroup, aasName))
    const sidecarContainer = siteContainers.find((c) => c.name === SIDECAR_CONTAINER_NAME)
    const envVars = getEnvVars(config, isContainer)
    // We need to ensure that the sidecar container is configured correctly, which means checking the image, target port,
    // and environment variables. The sidecar environment variables must have matching names and values, as the sidecar
    // env values point to env keys in the main App Settings. (essentially env var forwarding)
    if (
      sidecarContainer === undefined ||
      sidecarContainer.image !== SIDECAR_IMAGE ||
      sidecarContainer.targetPort !== String(SIDECAR_PORT) ||
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
          targetPort: String(SIDECAR_PORT),
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
