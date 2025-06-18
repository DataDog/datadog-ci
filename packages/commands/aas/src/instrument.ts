import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import {DATADOG_SITE_US1} from '@datadog/datadog-ci-core/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-core/helpers/apikey'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-core/helpers/renderer'
import {maskString} from '@datadog/datadog-ci-core/helpers/utils'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import equal from 'fast-deep-equal/es6'

import {
  AasCommand,
  collectAsyncIterator,
  getEnvVars,
  isDotnet,
  isWindows,
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

  private shouldNotRestart = Option.Boolean('--no-restart', false, {
    description: 'Do not restart the App Service after applying instrumentation.',
  })

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [config, errors] = await this.ensureConfig()
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
    const cred = new DefaultAzureCredential()
    try {
      await cred.getToken('https://management.azure.com/.default')
    } catch (error) {
      this.context.stdout.write(
        renderSoftWarning(
          `Failed to authenticate with Azure: ${
            error.name
          }\n\nPlease ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run ${chalk.bold(
            'az login'
          )} to authenticate.\n`
        )
      )

      return 1
    }
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Instrumenting Azure App Service\n`)
    const client = new WebSiteManagementClient(cred, config.subscriptionId, {apiVersion: '2024-11-01'})

    const site = await client.webApps.get(config.resourceGroup, config.aasName)
    if (isWindows(site)) {
      this.context.stdout.write(
        renderSoftWarning(
          `Only Linux-based Azure App Services are currently supported.
Please see the documentation for information on
how to instrument Windows-based App Services:
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows`
        )
      )

      return 1
    }

    config.isDotnet = config.isDotnet || isDotnet(site)
    try {
      await this.instrumentSidecar(client, config, config.resourceGroup, config.aasName)
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to instrument sidecar: ${error}`))

      return 1
    }

    if (!this.shouldNotRestart) {
      this.context.stdout.write(`${this.dryRunPrefix}Restarting Azure App Service\n`)
      if (!this.dryRun) {
        try {
          await client.webApps.restart(config.resourceGroup, config.aasName)
        } catch (error) {
          this.context.stdout.write(renderError(`Failed to restart Azure App Service: ${error}`))

          return 1
        }
      }
    }

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Instrumentation complete!\n`)

    return 0
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
        )}\n`
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
      this.context.stdout.write(`${this.dryRunPrefix}Updating Application Settings\n`)
      if (!this.dryRun) {
        await client.webApps.updateApplicationSettings(resourceGroup, aasName, updatedEnvVars)
      }
    } else {
      this.context.stdout.write(`${this.dryRunPrefix}No Application Settings changes needed.\n`)
    }
  }
}
