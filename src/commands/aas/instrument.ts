import {StringDictionary, WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import equal from 'fast-deep-equal/es6'

import {DATADOG_SITE_US1} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
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
    description: 'How you want to tag your service. For example, `my-service`',
  })
  private environment = Option.String('--env,--environment', {
    description: 'How you want to tag your env. For example, `prod`',
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

  public get additionalConfig(): Partial<AasConfigOptions> {
    return {
      service: this.service,
      environment: this.environment,
      isInstanceLoggingEnabled: this.isInstanceLoggingEnabled,
      logPath: this.logPath,
      shouldNotRestart: this.shouldNotRestart,
      isDotnet: this.isDotnet,
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
    const cred = new DefaultAzureCredential()
    if (!(await this.ensureAzureAuth(cred))) {
      return 1
    }
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning instrumentation of Azure App Service(s)\n`)
    const results = await Promise.all(
      Object.entries(appServicesToInstrument).map(([subscriptionId, resourceGroupToNames]) =>
        this.processSubscription(cred, subscriptionId, resourceGroupToNames, config)
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
    subscriptionId: string,
    resourceGroupToNames: Record<string, string[]>,
    config: AasConfigOptions
  ): Promise<boolean> {
    const client = new WebSiteManagementClient(cred, subscriptionId, {apiVersion: '2024-11-01'})
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, aasNames]) =>
        aasNames.map((aasName) => this.processAas(client, config, resourceGroup, aasName))
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Azure App Service for instrumentation.
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

      await this.instrumentSidecar(
        client,
        {...config, isDotnet: config.isDotnet || isDotnet(site)},
        resourceGroup,
        aasName
      )
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to instrument ${aasName}: ${formatError(error)}`))

      return false
    }

    if (!config.shouldNotRestart) {
      this.context.stdout.write(`${this.dryRunPrefix}Restarting Azure App Service ${chalk.bold(aasName)}\n`)
      if (!this.dryRun) {
        try {
          await client.webApps.restart(resourceGroup, aasName)
        } catch (error) {
          this.context.stdout.write(renderError(`Failed to restart Azure App Service ${chalk.bold(aasName)}: ${error}`))

          return false
        }
      }
    }

    return true
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
