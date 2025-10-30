import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {ContainerAppCommand, ContainerAppConfigOptions} from './common'
import {DEFAULT_VOLUME_PATH, DEFAULT_LOGS_PATH, DEFAULT_VOLUME_NAME} from '../../helpers/serverless/common'

export class ContainerAppInstrumentCommand extends ContainerAppCommand {
  public static paths = [['container-app', 'instrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Azure Container App.',
  })

  private service = Option.String('--service', {
    description: 'The value for the service tag. For example, `my-service`',
  })
  private environment = Option.String('--env,--environment', {
    description: 'The value for the env tag. For example, `prod`',
  })
  private version = Option.String('--version', {
    description: 'The value for the version tag. For example, `1.0.0`',
  })
  private isInstanceLoggingEnabled = Option.Boolean('--instance-logging', false, {
    description:
      'When enabled, log collection is automatically configured for an additional file path: /home/LogFiles/*$COMPUTERNAME*.log',
  })
  private logPath = Option.String('--log-path', {
    description: 'Where you write your logs. For example, /home/LogFiles/*.log or /home/LogFiles/myapp/*.log',
  })
  private shouldNotRestart = Option.Boolean('--no-restart', false, {
    description: 'Do not restart the Container App after applying instrumentation.',
  })

  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Enable source code integration to add git metadata as tags. Defaults to enabled. Specify `--no-source-code-integration` to disable.',
  })

  private uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description: 'Upload git metadata to Datadog. Defaults to enabled. Specify `--no-upload-git-metadata` to disable.',
  })

  private extraTags = Option.String('--extra-tags,--extraTags', {
    description: 'Additional tags to add to the service in the format "key1:value1,key2:value2"',
  })

  private sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `(Not recommended) The name to use for the shared volume. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  private sharedVolumePath = Option.String('--shared-volume-path', DEFAULT_VOLUME_PATH, {
    description: `(Not recommended) The path to use for the shared volume. Defaults to '${DEFAULT_VOLUME_PATH}'`,
  })
  private logsPath = Option.String('--logs-path', DEFAULT_LOGS_PATH, {
    description: `(Not recommended) The path to use for the logs. Defaults to '${DEFAULT_LOGS_PATH}'. Must begin with the shared volume path.`,
  })

  public get additionalConfig(): Partial<ContainerAppConfigOptions> {
    return {
      service: this.service,
      environment: this.environment,
      version: this.version,
      isInstanceLoggingEnabled: this.isInstanceLoggingEnabled,
      logPath: this.logPath,
      shouldNotRestart: this.shouldNotRestart,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
      sharedVolumeName: this.sharedVolumeName,
      sharedVolumePath: this.sharedVolumePath,
      logsPath: this.logsPath,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
