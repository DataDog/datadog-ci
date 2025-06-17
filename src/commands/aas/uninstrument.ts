import {WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command} from 'clipanion'

import {renderError} from '../../helpers/renderer'

import {AAS_DD_SETTING_NAMES, AasCommand, formatError, isDotnet, SIDECAR_CONTAINER_NAME} from './common'
import {AasConfigOptions} from './interfaces'

export class UninstrumentCommand extends AasCommand {
  public static paths = [['aas', 'uninstrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Remove Datadog instrumentation from an Azure App Service.',
  })

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [appServicesToUninstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    const cred = new DefaultAzureCredential()
    if (!(await this.ensureAzureAuth(cred))) {
      return 1
    }
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning uninstrumentation of Azure App Service(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToUninstrument).map(([subscriptionId, resourceGroupToNames]) =>
        this.processSubscription(cred, subscriptionId, resourceGroupToNames, config)
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
    cred: DefaultAzureCredential,
    subscriptionId: string,
    resourceGroupToNames: Record<string, string[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const client = new WebSiteManagementClient(cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).map(([resourceGroup, aasNames]) =>
        Promise.all(aasNames.map((aasName) => this.processAas(client, config, resourceGroup, aasName)))
      )
    )

    return results.every((result) => result.every((r) => r))
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
      const site = await client.webApps.get(resourceGroup, aasName)
      if (!this.ensureLinux(site)) {
        return false
      }

      await this.uninstrumentSidecar(
        client,
        {...config, isDotnet: config.isDotnet || isDotnet(site)},
        resourceGroup,
        aasName
      )
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to uninstrument ${aasName}: ${formatError(error)}`))

      return false
    }

    return true
  }

  public async uninstrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ) {
    this.context.stdout.write(
      `${this.dryRunPrefix}Removing sidecar container ${chalk.bold(SIDECAR_CONTAINER_NAME)} (if it exists)\n`
    )
    if (!this.dryRun) {
      await client.webApps.deleteSiteContainer(resourceGroup, aasName, SIDECAR_CONTAINER_NAME)
    }
    this.context.stdout.write(`${this.dryRunPrefix}Checking Application Settings\n`)
    const currentEnvVars = (await client.webApps.listApplicationSettings(resourceGroup, aasName)).properties
    if (currentEnvVars !== undefined && AAS_DD_SETTING_NAMES.some((key) => key in currentEnvVars)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings\n`)
      if (!this.dryRun) {
        await client.webApps.updateApplicationSettings(resourceGroup, aasName, {
          properties: Object.fromEntries(
            Object.entries(currentEnvVars).filter(([key]) => !(AAS_DD_SETTING_NAMES as readonly string[]).includes(key))
          ),
        })
      }
    } else {
      this.context.stdout.write(`${this.dryRunPrefix}No Application Settings changes needed.\n`)
    }
  }
}
