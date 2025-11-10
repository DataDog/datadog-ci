import {ContainerAppsAPIClient, ContainerApp, Container, Secret} from '@azure/arm-appcontainers'
import {ResourceManagementClient, TagsOperations} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
import {ContainerAppInstrumentCommand} from '@datadog/datadog-ci-base/commands/container-app/instrument'
import {DATADOG_SITE_US1} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {ensureAzureAuth, formatError} from '@datadog/datadog-ci-base/helpers/serverless/azure'
import {createInstrumentedTemplate, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DEFAULT_HEALTH_CHECK_PORT,
  SIDECAR_CONTAINER_NAME,
  SIDECAR_IMAGE,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'

import {DD_API_KEY_SECRET_NAME, getEnvVarsByName} from '../common'

export class PluginCommand extends ContainerAppInstrumentCommand {
  private cred!: DefaultAzureCredential
  private tagClient!: TagsOperations

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [containerAppsToInstrument, config, errors] = await this.ensureConfig()
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

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning instrumentation of Azure Container App(s)\n`)
    const results = await Promise.all(
      Object.entries(containerAppsToInstrument).map(([subscriptionId, resourceGroupToNames]) =>
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
    config: ContainerAppConfigOptions
  ): Promise<boolean> {
    const containerAppClient = new ContainerAppsAPIClient(this.cred, subscriptionId)
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, containerAppNames]) =>
        containerAppNames.map((containerAppName) =>
          this.processContainerApp(containerAppClient, config, resourceGroup, containerAppName)
        )
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Azure Container App for instrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processContainerApp(
    containerAppClient: ContainerAppsAPIClient,
    config: ContainerAppConfigOptions,
    resourceGroup: string,
    containerAppName: string
  ): Promise<boolean> {
    try {
      const [containerApp, secrets] = await Promise.all([
        containerAppClient.containerApps.get(resourceGroup, containerAppName),
        containerAppClient.containerApps.listSecrets(resourceGroup, containerAppName),
      ])
      // insert secrets since they're not exposed by the get api
      containerApp.configuration = {...containerApp.configuration, secrets: secrets.value}
      config = {...config, service: config.service ?? containerAppName}

      await this.instrumentSidecar(containerAppClient, config, resourceGroup, containerApp)
      await this.addTags(config, containerAppClient.subscriptionId, resourceGroup, containerApp)
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to instrument ${containerAppName}: ${formatError(error)}`))

      return false
    }

    return true
  }

  public async addTags(
    config: ContainerAppConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    containerApp: ContainerApp
  ): Promise<void> {
    const updatedTags: Record<string, string> = {
      ...containerApp.tags,
      service: config.service!,
      [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE,
    }
    if (config.environment) {
      updatedTags.env = config.environment
    }
    if (config.version) {
      updatedTags.version = config.version
    }
    if (!sortedEqual(containerApp.tags, updatedTags)) {
      this.context.stdout.write(`${this.dryRunPrefix}Updating tags for ${chalk.bold(containerApp.name)}\n`)
      if (!this.dryRun) {
        try {
          await this.tagClient.beginCreateOrUpdateAtScopeAndWait(
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${containerApp.name}`,
            {properties: {tags: updatedTags}}
          )
        } catch (error) {
          this.context.stdout.write(
            renderError(`Failed to update tags for ${chalk.bold(containerApp.name)}: ${formatError(error)}`)
          )
        }
      }
    }
  }

  public async instrumentSidecar(
    client: ContainerAppsAPIClient,
    config: ContainerAppConfigOptions,
    resourceGroup: string,
    containerApp: ContainerApp
  ) {
    const updatedAppConfig = this.createInstrumentedAppConfig(
      config,
      client.subscriptionId,
      resourceGroup,
      containerApp
    )
    if (sortedEqual(containerApp, updatedAppConfig)) {
      this.context.stdout.write(
        `${this.dryRunPrefix}Sidecar container ${chalk.bold(
          SIDECAR_CONTAINER_NAME
        )} already exists with correct configuration.\n`
      )

      return
    }

    // Update configuration
    this.context.stdout.write(`${this.dryRunPrefix}Updating configuration for ${chalk.bold(containerApp.name)}\n`)

    if (!this.dryRun) {
      await client.containerApps.beginUpdateAndWait(resourceGroup, containerApp.name!, updatedAppConfig)
    }
  }

  public createInstrumentedAppConfig(
    config: ContainerAppConfigOptions,
    subscriptionId: string,
    resourceGroup: string,
    containerApp: ContainerApp
  ): ContainerApp {
    const envVarsByName = getEnvVarsByName(config, subscriptionId, resourceGroup)
    // Build base sidecar container
    const baseSidecar: Container = {
      name: SIDECAR_CONTAINER_NAME,
      image: SIDECAR_IMAGE,
      resources: {
        cpu: 0.25,
        memory: '0.5Gi',
      },
      probes: [
        {
          type: 'Startup',
          tcpSocket: {
            port: DEFAULT_HEALTH_CHECK_PORT,
          },
          initialDelaySeconds: 0,
          periodSeconds: 10,
          failureThreshold: 3,
          timeoutSeconds: 1,
        },
      ],
    }

    // Use shared helper to create instrumented template
    const updatedTemplate = createInstrumentedTemplate(
      containerApp.template ?? {},
      baseSidecar,
      {
        name: config.sharedVolumeName!,
        mountPath: config.sharedVolumePath!,
        mountOptions: {storageType: 'EmptyDir'},
        volumeMountNameKey: 'volumeName',
      },
      envVarsByName
    )

    const secrets = containerApp.configuration?.secrets ?? []
    const hasApiKey = secrets.some(({name}) => name === DD_API_KEY_SECRET_NAME)
    const updatedSecrets: Secret[] = secrets.map((secret) =>
      secret.name === DD_API_KEY_SECRET_NAME ? {name: DD_API_KEY_SECRET_NAME, value: process.env.DD_API_KEY!} : secret
    )
    if (!hasApiKey) {
      updatedSecrets.push({name: DD_API_KEY_SECRET_NAME, value: process.env.DD_API_KEY!})
    }

    return {
      ...containerApp,
      configuration: {...containerApp.configuration, secrets: updatedSecrets},
      template: updatedTemplate,
    }
  }
}
