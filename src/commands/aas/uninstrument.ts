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

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Uninstrumenting Azure App Service\n`)
    const client = new WebSiteManagementClient(cred, config.subscriptionId, {apiVersion: '2024-11-01'})
    try {
      const site = await client.webApps.get(config.resourceGroup, config.aasName)
      if (!this.ensureLinux(site)) {
        return 1
      }
      config.isDotnet = config.isDotnet || isDotnet(site)
      await this.uninstrumentSidecar(client, config, config.resourceGroup, config.aasName)
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to uninstrument: ${formatError(error)}`))

      return 1
    }

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Uninstrumentation complete!\n`)

    return 0
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
