import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {parseResourceId} from '../../helpers/serverless/azure'
import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from '../../helpers/serverless/constants'

import {ContainerAppCommand, ContainerAppConfigOptions, ContainerAppBySubscriptionAndGroup} from './common'

export class ContainerAppUninstrumentCommand extends ContainerAppCommand {
  public static paths = [['container-app', 'uninstrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in an Azure Container App.',
  })

  private sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `The name of the sidecar container to remove. Specify if you have a different sidecar name. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  private sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `The name of the shared volume to remove. Specify if you have a different shared volume name. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })

  public get additionalConfig(): Partial<ContainerAppConfigOptions> {
    return {
      sidecarName: this.sidecarName,
      sharedVolumeName: this.sharedVolumeName,
    }
  }

  public async ensureConfig(): Promise<[ContainerAppBySubscriptionAndGroup, ContainerAppConfigOptions, string[]]> {
    const [containerApps, config, errors] = await super.ensureConfig()

    // Remove errors that are specific to instrumentation
    const filteredErrors = errors.filter(
      (error) =>
        !error.includes('DD_API_KEY') &&
        !error.includes('logsPath') &&
        !error.includes('sharedVolumePath') &&
        !error.includes('Extra tags')
    )

    return [containerApps, config, filteredErrors]
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
