import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {
  DEFAULT_VOLUME_PATH,
  DEFAULT_LOGS_PATH,
  DEFAULT_VOLUME_NAME,
  DEFAULT_SIDECAR_NAME,
} from '../../helpers/serverless/constants'

import {ContainerAppCommand, ContainerAppConfigOptions} from './common'

export const DEFAULT_SIDECAR_CPU = '0.5'
export const DEFAULT_SIDECAR_MEMORY = '1Gi'

export class ContainerAppInstrumentCommand extends ContainerAppCommand {
  public static paths = [['container-app', 'instrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Azure Container App.',
  })

  private service = Option.String('--service', {
    description:
      'The value for the service tag. Use this to group related Container Apps belonging to similar workloads. For example, `my-service`. If not provided, the Container App name is used.',
  })
  private environment = Option.String('--env,--environment', {
    description:
      'The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`.',
  })
  private version = Option.String('--version', {
    description:
      'The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`.',
  })
  private sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `(Not recommended) The name to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  private sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `(Not recommended) Specify a custom shared volume name. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  private sharedVolumePath = Option.String('--shared-volume-path', DEFAULT_VOLUME_PATH, {
    description: `(Not recommended) Specify a custom shared volume path. Defaults to '${DEFAULT_VOLUME_PATH}'`,
  })
  private logsPath = Option.String('--logs-path', DEFAULT_LOGS_PATH, {
    description: `(Not recommended) Specify a custom log file path. Must begin with the shared volume path. Defaults to '${DEFAULT_LOGS_PATH}'`,
  })
  private sidecarCpu = Option.String('--sidecar-cpu', DEFAULT_SIDECAR_CPU, {
    description: `The number of CPUs to allocate to the sidecar container. Defaults to '${DEFAULT_SIDECAR_CPU}'.`,
  })
  private sidecarMemory = Option.String('--sidecar-memory', DEFAULT_SIDECAR_MEMORY, {
    description: `The amount of memory to allocate to the sidecar container. Defaults to '${DEFAULT_SIDECAR_MEMORY}'.`,
  })

  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable.',
  })

  private uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description:
      "Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify `--no-upload-git-metadata` to disable.",
  })

  private extraTags = Option.String('--extra-tags,--extraTags', {
    description: 'Additional tags to add to the app in the format "key1:value1,key2:value2".',
  })

  public get additionalConfig(): Partial<ContainerAppConfigOptions> {
    return {
      service: this.service,
      environment: this.environment,
      version: this.version,
      sidecarName: this.sidecarName,
      sharedVolumeName: this.sharedVolumeName,
      sharedVolumePath: this.sharedVolumePath,
      logsPath: this.logsPath,
      sidecarCpu: this.sidecarCpu,
      sidecarMemory: this.sidecarMemory,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
