import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {
  DEFAULT_VOLUME_PATH,
  DEFAULT_LOGS_PATH,
  DEFAULT_SIDECAR_NAME,
  DEFAULT_VOLUME_NAME,
} from '../../helpers/serverless/constants'

import {BaseCommand} from '../..'

const DEFAULT_SIDECAR_IMAGE = 'gcr.io/datadoghq/serverless-init:latest'

export class CloudRunInstrumentCommand extends BaseCommand {
  public static paths = [['cloud-run', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Cloud Run app.',
  })

  // protected configPath = Option.String('--config') implement if requested by customers
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description:
      'Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply.',
  })

  protected extraTags = Option.String('--extra-tags,--extraTags')
  protected envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to set for the Cloud Run service. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })
  protected project = Option.String('-p,--project', {
    description: 'The name of the Google Cloud project where the Cloud Run service is hosted.',
  })
  protected services = Option.Array('-s,--service,--services', [], {
    description: 'Cloud Run service(s) to instrument',
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: 'Prompt for flags one at a time',
  })
  protected region = Option.String('-r,--region', {
    description: 'The region where the Cloud Run service is hosted.',
  })
  protected logLevel = Option.String('--log-level,--logLevel')
  protected sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable.',
  })
  protected uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description: "Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify `--no-upload-git-metadata` to disable.",
  })
  protected tracing = Option.String('--tracing')
  protected serviceTag = Option.String('--service-tag,--serviceTag', {
    description:
      'The value for the service tag. Use this to group related Cloud Run services belonging to similar workloads. For example, `my-service`. If not provided, the Cloud Run service name is used.',
  })
  protected version = Option.String('--version', {
    description:
      'The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`.',
  })
  protected environment = Option.String('--env', {
    description:
      'The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`.',
  })
  protected llmobs = Option.String('--llmobs')
  protected healthCheckPort = Option.String('--port,--health-check-port,--healthCheckPort')
  protected sidecarImage = Option.String('--image,--sidecar-image', DEFAULT_SIDECAR_IMAGE, {
    description: `The image to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_IMAGE}'`,
  })
  protected sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `(Not recommended) The name to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  protected sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `(Not recommended) Specify a custom shared volume name. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  protected sharedVolumePath = Option.String('--shared-volume-path', DEFAULT_VOLUME_PATH, {
    description: `(Not recommended) Specify a custom shared volume path. Defaults to '${DEFAULT_VOLUME_PATH}'`,
  })
  protected logsPath = Option.String('--logs-path', DEFAULT_LOGS_PATH, {
    description: `(Not recommended) Specify a custom log file path. Must begin with the shared volume path. Defaults to '${DEFAULT_LOGS_PATH}'`,
  })
  protected sidecarCpus = Option.String('--sidecar-cpus', '1', {
    description: `The number of CPUs to allocate to the sidecar container. Defaults to 1.`,
  })
  protected sidecarMemory = Option.String('--sidecar-memory', '512Mi', {
    description: `The amount of memory to allocate to the sidecar container. Defaults to '512Mi'.`,
  })
  protected language = Option.String('--language', {
    description: `Set the language used in your container or function for advanced log parsing. Sets the DD_SOURCE env var. Possible values: "nodejs", "python", "go", "java", "csharp", "ruby", or "php".`,
  })
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
