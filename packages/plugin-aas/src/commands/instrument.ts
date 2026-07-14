import type {Site, SiteContainer, StringDictionary} from '@azure/arm-appservice'
import type {AasConfigOptions, WebApp, WindowsRuntime} from '@datadog/datadog-ci-base/commands/aas/common'

import {WebSiteManagementClient} from '@azure/arm-appservice'
import {ResourceManagementClient} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {
  getExtensionId,
  renderWebApp,
  resourceIdSegment,
  WINDOWS_RUNTIME_EXTENSIONS,
} from '@datadog/datadog-ci-base/commands/aas/common'
import {AasInstrumentCommand} from '@datadog/datadog-ci-base/commands/aas/instrument'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {ensureAzureAuth, formatError} from '@datadog/datadog-ci-base/helpers/serverless/azure'
import {collectAsyncIterator, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  SIDECAR_CONTAINER_NAME,
  SIDECAR_IMAGE,
  SIDECAR_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'

import {
  aggregateStickyBySite,
  getWindowsRuntime,
  getEnvVars,
  isConsumptionPlan,
  isDotnet,
  isFunctionApp,
  isLinuxContainer,
  isWindows,
  mutateStickySlotSettings,
  stickySlotSettings,
  WEBSITE_PRIVATE_EXTENSIONS,
  type ProcessResult,
  AZURE_FUNCTIONS_DOCS_URL,
  AZURE_WINDOWS_FUNCTIONS_DOCS_URL,
} from '../common'

// Pin DD_ENV (set via --env) plus any extra names sticky to the slot.
const stickyNames = (config: AasConfigOptions, additional: string[] = []): string[] => [
  ...additional,
  ...(config.environment ? ['DD_ENV'] : []),
]

export class PluginCommand extends AasInstrumentCommand {
  private cred!: DefaultAzureCredential
  private resourceClient!: ResourceManagementClient

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [appServicesToInstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    let isApiKeyValid: boolean
    try {
      isApiKeyValid = await newApiKeyValidator({
        apiKey: process.env.DD_API_KEY,
        datadogSite: getDatadogSite(),
      }).validateApiKey()
    } catch (e) {
      this.context.stdout.write(
        renderSoftWarning(
          `Could not validate the API Key stored in the environment variable ${chalk.bold('DD_API_KEY')}: ${maskString(
            process.env.DD_API_KEY ?? ''
          )}\nA network error occurred while contacting the Datadog API. If you are behind a corporate proxy, ensure ${chalk.bold('HTTP_PROXY')} and ${chalk.bold('HTTPS_PROXY')} are set correctly.\nError: ${e}`
        )
      )

      return 1
    }
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

    this.cred = new DefaultAzureCredential()
    if (!(await ensureAzureAuth((msg) => this.context.stdout.write(msg), this.cred))) {
      return 1
    }
    this.resourceClient = new ResourceManagementClient(this.cred)

    if (config.sourceCodeIntegration) {
      config.extraTags = await handleSourceCodeIntegration(
        this.context,
        config.uploadGitMetadata ?? true,
        config.extraTags
      )
    }

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning instrumentation of Web App(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToInstrument).map(([subscriptionId, resourceGroupToWebApps]) =>
        this.processSubscription(subscriptionId, resourceGroupToWebApps, config)
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
    resourceGroupToNames: Record<string, WebApp[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const aasClient = new WebSiteManagementClient(this.cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, webApps]) =>
        webApps.map((webApp) => this.processWebApp(aasClient, config, resourceGroup, webApp))
      )
    )

    // Register sticky settings once per site (slotConfigNames is site-level) to avoid
    // concurrent read-modify-writes racing when multiple slots of one app are instrumented.
    await Promise.all(
      aggregateStickyBySite(results.map((result) => result.sticky)).map(({resourceGroup, webAppName, names}) =>
        mutateStickySlotSettings(aasClient, resourceGroup, webAppName, names, 'add', {
          dryRun: this.dryRun,
          dryRunPrefix: this.dryRunPrefix,
          log: (message) => this.context.stdout.write(message),
        })
      )
    )

    return results.every((result) => result.success)
  }

  /**
   * Process an Web App or slot for instrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processWebApp(
    aasClient: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp
  ): Promise<ProcessResult> {
    // make config a copy with the default service added
    config = {...config, service: config.service ?? webApp.name}
    const sticky = stickySlotSettings(resourceGroup, webApp, stickyNames(config))
    try {
      const [site, envVarDictionary] = await Promise.all(
        webApp.slot
          ? [
              aasClient.webApps.getSlot(resourceGroup, webApp.name, webApp.slot),
              aasClient.webApps.listApplicationSettingsSlot(resourceGroup, webApp.name, webApp.slot),
            ]
          : [
              aasClient.webApps.get(resourceGroup, webApp.name),
              aasClient.webApps.listApplicationSettings(resourceGroup, webApp.name),
            ]
      )
      const existingEnvVars = envVarDictionary.properties ?? {}

      // Determine instrumentation method based on platform
      if (isFunctionApp(site) && !isWindows(site)) {
        this.context.stdout.write(
          renderError(`Linux Function Apps are not supported by this command. See ${AZURE_FUNCTIONS_DOCS_URL}`)
        )

        return {success: false}
      }

      if (isWindows(site)) {
        // Windows instrumentation via extension
        const runtime = config.windowsRuntime ?? getWindowsRuntime(site, existingEnvVars)

        if (isFunctionApp(site)) {
          if (isConsumptionPlan(site)) {
            this.context.stdout.write(
              renderError(
                `Windows Function Apps require a Dedicated (App Service) or Premium plan. See ${AZURE_WINDOWS_FUNCTIONS_DOCS_URL}`
              )
            )

            return {success: false}
          }
          if (runtime !== 'dotnet') {
            this.context.stdout.write(
              renderError(
                `Windows Function Apps with the ${runtime ?? 'unknown'} runtime are not supported by this command. See ${AZURE_FUNCTIONS_DOCS_URL}`
              )
            )

            return {success: false}
          }
          // Slots need WEBSITE_PRIVATE_EXTENSIONS=0 pinned sticky so it survives a swap.
          await this.instrumentExtension(aasClient, config, resourceGroup, webApp, 'dotnet', existingEnvVars, site)
          // tag only after instrumentation succeeds (avoids false telemetry)
          await this.addTags(config, aasClient.subscriptionId!, resourceGroup, webApp, site.tags ?? {})

          return {
            success: true,
            sticky: stickySlotSettings(resourceGroup, webApp, stickyNames(config, [WEBSITE_PRIVATE_EXTENSIONS])),
          }
        }

        if (!runtime) {
          this.context.stdout.write(
            renderSoftWarning(
              `Unable to detect runtime for Windows Web App ${renderWebApp(webApp)}. Skipping instrumentation. Try manually specifying your runtime with \`--windows-runtime\``
            )
          )

          return {success: false}
        }
        await this.instrumentExtension(aasClient, config, resourceGroup, webApp, runtime, existingEnvVars, site)
        // tag only after instrumentation succeeds (avoids false telemetry)
        await this.addTags(config, aasClient.subscriptionId!, resourceGroup, webApp, site.tags ?? {})

        return {success: true, sticky}
      }

      // Linux instrumentation via sidecar
      const isContainer = isLinuxContainer(site)
      if (config.isMusl && !isContainer) {
        this.context.stdout.write(
          renderSoftWarning(
            `The --musl flag is set, but the Web App ${renderWebApp(webApp)} is not a containerized app. \
This flag is only applicable for containerized .NET apps (on musl-based distributions like Alpine Linux), and will be ignored.`
          )
        )
      }
      config.isDotnet ||= isDotnet(site)
      config.isMusl &&= config.isDotnet && isContainer
      await this.instrumentSidecar(aasClient, config, resourceGroup, webApp, existingEnvVars, site)
      // tag only after instrumentation succeeds (avoids false telemetry)
      await this.addTags(config, aasClient.subscriptionId!, resourceGroup, webApp, site.tags ?? {})
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to instrument ${renderWebApp(webApp)}: ${formatError(error)}`))

      return {success: false}
    }

    if (!config.shouldNotRestart) {
      this.context.stdout.write(`${this.dryRunPrefix}Restarting Web App ${renderWebApp(webApp)}\n`)
      if (!this.dryRun) {
        try {
          await (webApp.slot
            ? aasClient.webApps.restartSlot(resourceGroup, webApp.name, webApp.slot)
            : aasClient.webApps.restart(resourceGroup, webApp.name))
        } catch (error) {
          this.context.stdout.write(renderError(`Failed to restart Web App ${renderWebApp(webApp)}: ${error}`))

          return {success: false}
        }
      }
    }

    return {success: true, sticky}
  }

  public async addTags(
    config: AasConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    webApp: WebApp,
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

  public async instrumentExtension(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp,
    runtime: WindowsRuntime,
    existingEnvVars: Record<string, string>,
    site: Site
  ) {
    const extensionId = WINDOWS_RUNTIME_EXTENSIONS[runtime]

    // Check if the extension is already installed
    const existingExtensions = await collectAsyncIterator(
      webApp.slot
        ? client.webApps.listSiteExtensionsSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.listSiteExtensions(resourceGroup, webApp.name)
    )
    const extensionInstalled = existingExtensions.some(
      (ext) => ext.name && getExtensionId(ext.name).toLowerCase() === extensionId.toLowerCase()
    )
    const envVars = getEnvVars(config, site, webApp)

    if (extensionInstalled) {
      this.context.stdout.write(
        `${this.dryRunPrefix}Site extension ${chalk.bold(extensionId)} already installed on ${renderWebApp(webApp)}.\n`
      )
      await this.updateEnvVars(client, resourceGroup, webApp, existingEnvVars, envVars)

      return
    }

    // Apply app settings before installing the extension (commits WEBSITE_PRIVATE_EXTENSIONS=0 for slots).
    await this.updateEnvVars(client, resourceGroup, webApp, existingEnvVars, envVars)

    this.context.stdout.write(`${this.dryRunPrefix}Stopping Web App ${renderWebApp(webApp)}\n`)
    if (!this.dryRun) {
      await (webApp.slot
        ? client.webApps.stopSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.stop(resourceGroup, webApp.name))
    }

    this.context.stdout.write(
      `${this.dryRunPrefix}Installing extension ${chalk.bold(extensionId)} on ${renderWebApp(webApp)}\n`
    )
    if (!this.dryRun) {
      // We make this call with the regular resources client because `client.webApps.beginInstallSiteExtensionAndWait` doesn't work
      await this.resourceClient.resources.beginCreateOrUpdateByIdAndWait(
        `/subscriptions/${client.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${resourceIdSegment(webApp)}/siteextensions/${extensionId}`,
        '2024-11-01',
        {}
      )
    }

    this.context.stdout.write(`${this.dryRunPrefix}Starting Web App ${renderWebApp(webApp)}\n`)
    if (!this.dryRun) {
      await (webApp.slot
        ? client.webApps.startSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.start(resourceGroup, webApp.name))
    }
  }

  public async instrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    webApp: WebApp,
    existingEnvVars: Record<string, string>,
    site: Site
  ) {
    const siteContainers = await collectAsyncIterator(
      webApp.slot
        ? client.webApps.listSiteContainersSlot(resourceGroup, webApp.name, webApp.slot)
        : client.webApps.listSiteContainers(resourceGroup, webApp.name)
    )
    const sidecarContainer = siteContainers.find((c) => c.name === SIDECAR_CONTAINER_NAME)
    const envVars = getEnvVars(config, site, webApp)
    // We need to ensure that the sidecar container is configured correctly, which means checking the image, target port,
    // and environment variables. The sidecar environment variables must have matching names and values, as the sidecar
    // env values point to env keys in the main App Settings. (essentially env var forwarding)
    if (
      sidecarContainer === undefined ||
      sidecarContainer.image !== (config.sidecarImage ?? SIDECAR_IMAGE) ||
      sidecarContainer.targetPort !== String(SIDECAR_PORT) ||
      !sidecarContainer.environmentVariables?.every(({name, value}) => name === value) ||
      !sortedEqual(new Set(sidecarContainer.environmentVariables.map(({name}) => name)), new Set(Object.keys(envVars)))
    ) {
      this.context.stdout.write(
        `${this.dryRunPrefix}${sidecarContainer === undefined ? 'Creating' : 'Updating'} sidecar container ${chalk.bold(
          SIDECAR_CONTAINER_NAME
        )} on ${renderWebApp(webApp)}\n`
      )
      if (!this.dryRun) {
        const sidecar: SiteContainer = {
          image: config.sidecarImage ?? SIDECAR_IMAGE,
          targetPort: String(SIDECAR_PORT),
          isMain: false,
          // We're allowing access to all env vars since it is simpler
          // and doesn't cause problems, but not all env vars are needed for the sidecar.
          environmentVariables: Object.keys(envVars).map((name) => ({name, value: name})),
        }
        await (webApp.slot
          ? client.webApps.createOrUpdateSiteContainerSlot(
              resourceGroup,
              webApp.name,
              webApp.slot,
              SIDECAR_CONTAINER_NAME,
              sidecar
            )
          : client.webApps.createOrUpdateSiteContainer(resourceGroup, webApp.name, SIDECAR_CONTAINER_NAME, sidecar))
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}Sidecar container ${chalk.bold(
          SIDECAR_CONTAINER_NAME
        )} already exists with correct configuration.\n`
      )
    }
    await this.updateEnvVars(client, resourceGroup, webApp, existingEnvVars, envVars)
  }

  private async updateEnvVars(
    client: WebSiteManagementClient,
    resourceGroup: string,
    webApp: WebApp,
    existingEnvVars: Record<string, string>,
    envVars: Record<string, string>
  ) {
    const updatedEnvVars: StringDictionary = {properties: {...existingEnvVars, ...envVars}}
    if (!sortedEqual(existingEnvVars, updatedEnvVars.properties)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings for ${renderWebApp(webApp)}\n`)
      if (!this.dryRun) {
        await (webApp.slot
          ? client.webApps.updateApplicationSettingsSlot(resourceGroup, webApp.name, webApp.slot, updatedEnvVars)
          : client.webApps.updateApplicationSettings(resourceGroup, webApp.name, updatedEnvVars))
      }
    } else {
      this.context.stdout.write(
        `${this.dryRunPrefix}No Application Settings changes needed for ${renderWebApp(webApp)}.\n`
      )
    }
  }
}
