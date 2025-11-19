import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {AasCommand, AasConfigOptions, WindowsRuntime} from './common'

export class AasInstrumentCommand extends AasCommand {
  public static paths = [['aas', 'instrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Azure App Service.',
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
    description: 'Do not restart the App Service after applying instrumentation.',
  })

  private isDotnet = Option.Boolean('--dotnet,--dotnet-container', false, {
    description:
      'Add in required .NET-specific configuration options, is automatically inferred for code runtimes. This should be specified if you are using a containerized .NET app.',
  })
  private isMusl = Option.Boolean('--musl', false, {
    description:
      'Add in required .NET-specific configuration options for musl-based .NET apps. This should be specified if you are using a containerized .NET app on a musl-based distribution like Alpine Linux.',
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

  private windowsRuntime = Option.String('--windows-runtime', {
    description: 'Manually specify Windows runtime (node, dotnet, or java) to override automatic detection for the extension to use.',
  })

  public get additionalConfig(): Partial<AasConfigOptions> {
    return {
      service: this.service,
      environment: this.environment,
      version: this.version,
      isInstanceLoggingEnabled: this.isInstanceLoggingEnabled,
      logPath: this.logPath,
      shouldNotRestart: this.shouldNotRestart,
      isDotnet: this.isDotnet,
      isMusl: this.isMusl,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
      windowsRuntime: this.windowsRuntime as WindowsRuntime | undefined,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
