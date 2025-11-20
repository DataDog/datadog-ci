import {WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {AasConfigOptions, getExtensionId} from '@datadog/datadog-ci-base/commands/aas/common'
import {AasUninstrumentCommand} from '@datadog/datadog-ci-base/commands/aas/uninstrument'
import {renderError} from '@datadog/datadog-ci-base/helpers/renderer'
import {ensureAzureAuth, formatError} from '@datadog/datadog-ci-base/helpers/serverless/azure'
import {collectAsyncIterator, parseEnvVars, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {SIDECAR_CONTAINER_NAME} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {SERVERLESS_CLI_VERSION_TAG_NAME} from '@datadog/datadog-ci-base/helpers/tags'
import chalk from 'chalk'

import {AAS_DD_SETTING_NAMES, isDotnet, isWindows} from '../common'

export class PluginCommand extends AasUninstrumentCommand {
  private cred!: DefaultAzureCredential
  private resourceClient!: ResourceManagementClient

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [appServicesToUninstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    this.cred = new DefaultAzureCredential()
    if (!(await ensureAzureAuth(this.context.stdout.write, this.cred))) {
      return 1
    }
    this.resourceClient = new ResourceManagementClient(this.cred)
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning uninstrumentation of Azure App Service(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToUninstrument).map(([subscriptionId, resourceGroupToNames]) =>
        this.processSubscription(subscriptionId, resourceGroupToNames, config)
      )
    )
    const success = results.every((result) => result)
    this.context.stdout.write(
      `${this.dryRunPrefix}🐶 Uninstrumentation completed ${
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
    const client = new WebSiteManagementClient(this.cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, aasNames]) =>
        aasNames.map((aasName) => this.processAas(client, config, resourceGroup, aasName))
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Azure App Service for uninstrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processAas(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ): Promise<boolean> {
    try {
      const [site, siteConfig] = await Promise.all([
        client.webApps.get(resourceGroup, aasName),
        client.webApps.getConfiguration(resourceGroup, aasName),
      ])
      // patch in the site config which is the real source of truth
      site.siteConfig = siteConfig
      // Determine uninstrumentation method based on platform
      if (isWindows(site)) {
        await this.uninstrumentExtension(
          client,
          {...config, service: config.service ?? aasName},
          resourceGroup,
          aasName
        )
      } else {
        // Linux uninstrumentation via sidecar
        await this.uninstrumentSidecar(
          client,
          {...config, isDotnet: config.isDotnet || isDotnet(site), service: config.service ?? aasName},
          resourceGroup,
          aasName
        )
      }
      await this.removeTags(client.subscriptionId!, resourceGroup, aasName, site.tags ?? {})
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to uninstrument ${chalk.bold(aasName)}: ${formatError(error)}`))

      return false
    }

    return true
  }

  public async uninstrumentExtension(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ) {
    // List all currently installed extensions
    const existingExtensions = await collectAsyncIterator(client.webApps.listSiteExtensions(resourceGroup, aasName))

    // Filter for any Datadog extensions
    const datadogExtensions = existingExtensions
      .map(({name}) => name && getExtensionId(name))
      .filter((ext) => ext?.startsWith('Datadog.AzureAppServices.'))

    if (datadogExtensions.length === 0) {
      this.context.stdout.write(`${this.dryRunPrefix}No Datadog extensions found on ${chalk.bold(aasName)}.\n`)
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}Removing ${datadogExtensions.length} Datadog extension(s) from ${chalk.bold(aasName)}: ${datadogExtensions.map((e) => chalk.bold(e)).join(', ')}\n`
      )

      if (!this.dryRun) {
        await Promise.all(
          datadogExtensions.map(async (extensionId) => {
            try {
              // We make this call with the regular resources client because `client.webApps.deleteSiteExtension` doesn't work
              await this.resourceClient.resources.beginDeleteByIdAndWait(
                `/subscriptions/${client.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${aasName}/siteextensions/${extensionId}`,
                '2024-11-01'
              )
            } catch (error) {
              const message = String(error).includes('not installed locally')
                ? `Extension ${chalk.bold(extensionId)} not found or already removed.\n`
                : `Unable to remove extension ${chalk.bold(extensionId)}: ${error}\n`
              this.context.stdout.write(message)
            }
          })
        )
      }
    }

    // Updaing the environment variables will trigger a restart
    await this.removeEnvVars(config, aasName, client, resourceGroup)
  }

  public async uninstrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ) {
    this.context.stdout.write(
      `${this.dryRunPrefix}Removing sidecar container ${chalk.bold(SIDECAR_CONTAINER_NAME)} from ${chalk.bold(
        aasName
      )} (if it exists)\n`
    )
    if (!this.dryRun) {
      await client.webApps.deleteSiteContainer(resourceGroup, aasName, SIDECAR_CONTAINER_NAME)
    }
    await this.removeEnvVars(config, aasName, client, resourceGroup)
  }

  public async removeEnvVars(
    config: AasConfigOptions,
    aasName: string,
    client: WebSiteManagementClient,
    resourceGroup: string
  ) {
    const configuredSettings = new Set([...AAS_DD_SETTING_NAMES, ...Object.keys(parseEnvVars(config.envVars))])
    this.context.stdout.write(`${this.dryRunPrefix}Checking Application Settings on ${chalk.bold(aasName)}\n`)
    const currentEnvVars = (await client.webApps.listApplicationSettings(resourceGroup, aasName)).properties
    if (currentEnvVars !== undefined && Object.keys(currentEnvVars).some((key) => configuredSettings.has(key))) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings for ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        await client.webApps.updateApplicationSettings(resourceGroup, aasName, {
          properties: Object.fromEntries(
            Object.entries(currentEnvVars).filter(([key]) => !configuredSettings.has(key))
          ),
        })
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}No Application Settings changes needed for ${chalk.bold(aasName)}.\n`
      )
    }
  }

  public async removeTags(
    subscriptionId: string,
    resourceGroup: string,
    aasName: string,
    tags: Record<string, string>
  ) {
    const updatedTags = {...tags}
    delete updatedTags.service
    delete updatedTags.env
    delete updatedTags.version
    delete updatedTags[SERVERLESS_CLI_VERSION_TAG_NAME]
    if (!sortedEqual(tags, updatedTags)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating tags for ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        try {
          await this.resourceClient.tagsOperations.beginCreateOrUpdateAtScopeAndWait(
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
}
