import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import equal from 'fast-deep-equal/es6'

import {renderError, renderSoftWarning} from '../../helpers/renderer'

import {AasCommand, collectAsyncIterator, SIDECAR_CONTAINER_NAME, SIDECAR_IMAGE, SIDECAR_PORT} from './common'
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
    // Validate the Datadog API key
    const apiKey = process.env.DD_API_KEY!
    const response = await fetch(`https://api.${process.env.DD_SITE ?? 'datadoghq.com'}/api/v1/validate`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'DD-API-KEY': apiKey,
      },
    })
    // no-dd-sa:typescript-best-practices/no-explicit-any
    const data: any = await response.json()
    if (data?.valid !== true) {
      const censoredKey =
        apiKey.length < 4 ? '(too short to display)' : '*'.repeat(apiKey.length - 4) + apiKey.slice(-4)
      this.context.stdout.write(
        renderSoftWarning(`Invalid API Key ${censoredKey}, ensure you copied the value and not the Key ID`)
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
    const client = new WebSiteManagementClient(cred, config.subscriptionId)

    const siteConfig = await client.webApps.getConfiguration(config.resourceGroup, config.aasName)
    if (siteConfig.kind && !siteConfig.kind.toLowerCase().includes('linux')) {
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

  public getEnvVars(config: AasConfigOptions): Record<string, string> {
    const envVars: Record<string, string> = {
      DD_API_KEY: process.env.DD_API_KEY!,
      DD_SITE: process.env.DD_SITE ?? 'datadoghq.com',
      DD_AAS_INSTANCE_LOGGING_ENABLED: config.isInstanceLoggingEnabled.toString(),
    }
    if (config.service) {
      envVars.DD_SERVICE = config.service
    }
    if (config.environment) {
      envVars.DD_ENV = config.environment
    }
    if (config.logPath) {
      envVars.DD_SERVERLESS_LOG_PATH = config.logPath
    }

    return envVars
  }

  public async instrumentSidecar(
    client: WebSiteManagementClient,
    config: AasConfigOptions,
    resourceGroup: string,
    aasName: string
  ) {
    const siteContainers = await collectAsyncIterator(client.webApps.listSiteContainers(resourceGroup, aasName))
    const sidecarContainer = siteContainers.find((c) => c.name === SIDECAR_CONTAINER_NAME)
    const envVars = this.getEnvVars(config)
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
