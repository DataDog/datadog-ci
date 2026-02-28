import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {
  AasConfigOptions,
  getExtensionId,
  renderWebApp,
  resourceIdSegment,
  WebApp,
} from '@datadog/datadog-ci-base/commands/aas/common'
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
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning uninstrumentation of Web App(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToUninstrument).map(([subscriptionId, resourceGroupToWebApps]) =>
        this.processSubscription(subscriptionId, resourceGroupToWebApps, config)
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
    resourceGroupToNames: Record<string, WebApp[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const client = new WebSiteManagementClient(this.cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, webApps]) =>
        webApps.map((webApp) => this.processWebApp(client, config, resourceGroup, webApp))
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Web App or slot for uninstrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processWebApp(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp
  ): Promise<boolean> {
    try {
      const [site, siteConfig] = await Promise.all(
        webApp.slot
          ? [
              client.webApps.getSlot(resourceGroup, webApp.name, webApp.slot),
              client.webApps.getConfigurationSlot(resourceGroup, webApp.name, webApp.slot),
            ]
          : [
              client.webApps.get(resourceGroup, webApp.name),
              client.webApps.getConfiguration(resourceGroup, webApp.name),
            ]
      )
      // patch in the site config which is the real source of truth
      site.siteConfig = siteConfig
      // Determine uninstrumentation method based on platform
      if (isWindows(site)) {
        await this.uninstrumentExtension(
          client,
          {...config, service: config.service ?? webApp.name},
          resourceGroup,
          webApp
        )
      } else {
        // Linux uninstrumentation via sidecar
        await this.uninstrumentSidecar(
          client,
          {...config, isDotnet: config.isDotnet || isDotnet(site), service: config.service ?? webApp.name},
          resourceGroup,
          webApp
        )
      }
      await this.removeTags(client.subscriptionId!, resourceGroup, webApp, site.tags ?? {})
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to uninstrument ${chalk.bold(webApp)}: ${formatError(error)}`))

      return false
    }

    return true
  }

  public async uninstrumentExtension(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp
  ) {
    // List all currently installed extensions
    const existingExtensions = await collectAsyncIterator(
      webApp.slot
        ? client.webApps.listSiteExtensionsSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.listSiteExtensions(resourceGroup, webApp.name)
    )

    // Filter for any Datadog extensions
    const datadogExtensions = existingExtensions
      .map(({name}) => name && getExtensionId(name))
      .filter((ext) => ext?.startsWith('Datadog.AzureAppServices.'))

    if (datadogExtensions.length === 0) {
      this.context.stdout.write(`${this.dryRunPrefix}No Datadog extensions found on ${renderWebApp(webApp)}.\n`)
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}Removing ${datadogExtensions.length} Datadog extension(s) from ${renderWebApp(webApp)}: ${datadogExtensions.map((e) => chalk.bold(e)).join(', ')}\n`
      )

      if (!this.dryRun) {
        await Promise.all(
          datadogExtensions.map(async (extensionId) => {
            try {
              // We make this call with the regular resources client because `client.webApps.deleteSiteExtension` doesn't work
              await this.resourceClient.resources.beginDeleteByIdAndWait(
                `/subscriptions/${client.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${resourceIdSegment(webApp)}/siteextensions/${extensionId}`,
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
    await this.removeEnvVars(config, webApp, client, resourceGroup)
  }

  public async uninstrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp
  ) {
    this.context.stdout.write(
      `${this.dryRunPrefix}Removing sidecar container ${chalk.bold(SIDECAR_CONTAINER_NAME)} from ${renderWebApp(webApp)} (if it exists)\n`
    )
    if (!this.dryRun) {
      await (webApp.slot
        ? client.webApps.deleteSiteContainerSlot(resourceGroup, webApp.name, webApp.slot, SIDECAR_CONTAINER_NAME)
        : client.webApps.deleteSiteContainer(resourceGroup, webApp.name, SIDECAR_CONTAINER_NAME))
    }
    await this.removeEnvVars(config, webApp, client, resourceGroup)
  }

  public async removeEnvVars(
    config: AasConfigOptions,
    webApp: WebApp,
    client: WebSiteManagementClient,
    resourceGroup: string
  ) {
    const configuredSettings = new Set([...AAS_DD_SETTING_NAMES, ...Object.keys(parseEnvVars(config.envVars))])
    this.context.stdout.write(`${this.dryRunPrefix}Checking Application Settings on ${renderWebApp(webApp)}\n`)
    const currentEnvVars = (
      await (webApp.slot
        ? client.webApps.listApplicationSettingsSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.listApplicationSettings(resourceGroup, webApp.name))
    ).properties
    if (currentEnvVars !== undefined && Object.keys(currentEnvVars).some((key) => configuredSettings.has(key))) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings for ${renderWebApp(webApp)}\n`)
      if (!this.dryRun) {
        const settings: StringDictionary = {
          properties: Object.fromEntries(
            Object.entries(currentEnvVars).filter(([key]) => !configuredSettings.has(key))
          ),
        }
        await (webApp.slot
          ? client.webApps.updateApplicationSettingsSlot(resourceGroup, webApp.name, webApp.slot, settings)
          : client.webApps.updateApplicationSettings(resourceGroup, webApp.name, settings))
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}No Application Settings changes needed for ${renderWebApp(webApp)}.\n`
      )
    }
  }

  public async removeTags(subscriptionId: string, resourceGroup: string, webApp: WebApp, tags: Record<string, string>) {
    const updatedTags = {...tags}
    delete updatedTags.service
    delete updatedTags.env
    delete updatedTags.version
    delete updatedTags[SERVERLESS_CLI_VERSION_TAG_NAME]
    if (!sortedEqual(tags, updatedTags)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating tags for ${renderWebApp(webApp)}\n`)
      if (!this.dryRun) {
        try {
          await this.resourceClient.tagsOperations.beginCreateOrUpdateAtScopeAndWait(
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${resourceIdSegment(webApp)}`,
            {properties: {tags: updatedTags}}
          )
        } catch (error) {
          this.context.stdout.write(
            renderError(`Failed to update tags for ${renderWebApp(webApp)}: ${formatError(error)}`)
          )
        }
      }
    }
  }
}
