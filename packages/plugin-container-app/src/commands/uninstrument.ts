import {ContainerAppsAPIClient, ContainerApp, Container, Volume, VolumeMount} from '@azure/arm-appcontainers'
import {ResourceManagementClient, TagsOperations} from '@azure/arm-resources'
import {DefaultAzureCredential} from '@azure/identity'
import {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
import {ContainerAppUninstrumentCommand} from '@datadog/datadog-ci-base/commands/container-app/uninstrument'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {ensureAzureAuth, formatError} from '@datadog/datadog-ci-base/helpers/serverless/azure'
import {parseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {SERVERLESS_CLI_VERSION_TAG_NAME} from '@datadog/datadog-ci-base/helpers/tags'
import chalk from 'chalk'

import {DD_API_KEY_SECRET_NAME} from '../common'

export class PluginCommand extends ContainerAppUninstrumentCommand {
  private cred!: DefaultAzureCredential
  private tagClient!: TagsOperations

  public async execute(): Promise<0 | 1> {
    this.enableFips()
    const [containerAppsToUninstrument, config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    this.cred = new DefaultAzureCredential()
    if (!(await ensureAzureAuth((msg) => this.context.stdout.write(msg), this.cred))) {
      return 1
    }
    this.tagClient = new ResourceManagementClient(this.cred).tagsOperations

    this.context.stdout.write(`${this.dryRunPrefix}🐶 Beginning uninstrumentation of Azure Container App(s)\n`)
    const results = await Promise.all(
      Object.entries(containerAppsToUninstrument).map(([subscriptionId, resourceGroupToNames]) =>
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
    config: ContainerAppConfigOptions
  ): Promise<boolean> {
    const containerAppClient = new ContainerAppsAPIClient(this.cred, subscriptionId)
    const results = await Promise.all(
      Object.entries(resourceGroupToNames).flatMap(([resourceGroup, containerAppNames]) =>
        containerAppNames.map((containerAppName) =>
          this.processContainerApp(containerAppClient, config, resourceGroup, containerAppName, subscriptionId)
        )
      )
    )

    return results.every((result) => result)
  }

  /**
   * Process an Azure Container App for uninstrumentation.
   * @returns A promise that resolves to a boolean indicating success or failure.
   */
  public async processContainerApp(
    containerAppClient: ContainerAppsAPIClient,
    config: ContainerAppConfigOptions,
    resourceGroup: string,
    containerAppName: string,
    subscriptionId: string
  ): Promise<boolean> {
    try {
      const containerApp = await containerAppClient.containerApps.get(resourceGroup, containerAppName)

      await this.uninstrumentSidecar(containerAppClient, config, resourceGroup, containerApp)
      await this.removeTags(subscriptionId, resourceGroup, containerApp)
    } catch (error) {
      this.context.stdout.write(renderError(`Failed to uninstrument ${containerAppName}: ${formatError(error)}`))

      return false
    }

    return true
  }

  public async removeTags(subscriptionId: string, resourceGroup: string, containerApp: ContainerApp): Promise<void> {
    const updatedTags = {...containerApp.tags}
    delete updatedTags.service
    delete updatedTags.env
    delete updatedTags.version
    delete updatedTags[SERVERLESS_CLI_VERSION_TAG_NAME]

    const tagsChanged =
      containerApp.tags?.service ||
      containerApp.tags?.env ||
      containerApp.tags?.version ||
      containerApp.tags?.[SERVERLESS_CLI_VERSION_TAG_NAME]

    if (tagsChanged) {
      this.context.stdout.write(`${this.dryRunPrefix}Removing tags from ${chalk.bold(containerApp.name)}\n`)
      if (!this.dryRun) {
        try {
          await this.tagClient.beginCreateOrUpdateAtScopeAndWait(
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${containerApp.name}`,
            {properties: {tags: updatedTags}}
          )
        } catch (error) {
          this.context.stdout.write(
            renderError(`Failed to remove tags from ${chalk.bold(containerApp.name)}: ${formatError(error)}`)
          )
        }
      }
    }
  }

  public async uninstrumentSidecar(
    client: ContainerAppsAPIClient,
    config: ContainerAppConfigOptions,
    resourceGroup: string,
    containerApp: ContainerApp
  ) {
    const updatedAppConfig = this.createUninstrumentedAppConfig(config, containerApp)

    // Update configuration
    this.context.stdout.write(`${this.dryRunPrefix}Updating configuration for ${chalk.bold(containerApp.name)}\n`)

    if (!this.dryRun) {
      await client.containerApps.beginUpdateAndWait(resourceGroup, containerApp.name!, updatedAppConfig)
    }
  }

  public createUninstrumentedAppConfig(
    config: ContainerAppConfigOptions,
    containerApp: ContainerApp
  ): ContainerApp {
    const containers = containerApp?.template?.containers ?? []
    const volumes = containerApp?.template?.volumes || []

    // Remove sidecar container
    let updatedContainers = containers.filter((c) => c.name !== config.sidecarName)

    if (updatedContainers.length === containers.length) {
      this.context.stdout.write(
        renderSoftWarning(
          `Sidecar container '${config.sidecarName}' not found, so no container was removed. Specify the container name with --sidecar-name.\n`
        )
      )
    }

    // Remove shared volume
    const updatedVolumes = volumes.filter((v) => v.name !== config.sharedVolumeName)

    // Update app containers to remove volume mounts and DD_* env vars
    updatedContainers = updatedContainers.map((c) => this.updateAppContainer(c, config))

    // Remove DD_API_KEY secret
    const secrets = containerApp.configuration?.secrets ?? []
    const updatedSecrets = secrets.filter((secret) => secret.name !== DD_API_KEY_SECRET_NAME)

    return {
      ...containerApp,
      configuration: {...containerApp.configuration, secrets: updatedSecrets},
      template: {
        ...containerApp.template,
        containers: updatedContainers,
        volumes: updatedVolumes,
      },
    }
  }

  // Remove volume mount, DD_* env vars, and custom env vars
  private updateAppContainer(appContainer: Container, config: ContainerAppConfigOptions): Container {
    const existingVolumeMounts = appContainer.volumeMounts || []
    const updatedVolumeMounts = existingVolumeMounts.filter((v: VolumeMount) => v.volumeName !== config.sharedVolumeName)

    const customEnvVars = parseEnvVars(config.envVars)

    const existingEnvVars = appContainer.env || []
    // Remove env vars beginning with DD_ and custom env vars
    const updatedEnvVars = existingEnvVars.filter(
      (v) => v.name && !v.name.startsWith('DD_') && !(v.name in customEnvVars)
    )

    return {
      ...appContainer,
      volumeMounts: updatedVolumeMounts,
      env: updatedEnvVars,
    }
  }
}
