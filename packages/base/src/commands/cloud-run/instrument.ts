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
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  protected environment = Option.String('--env')
  protected extraTags = Option.String('--extra-tags,--extraTags')
  protected project = Option.String('-p,--project', {
    description: 'GCP project ID',
  })
  protected services = Option.Array('-s,--service,--services', [], {
    description: 'Cloud Run service(s) to instrument',
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: 'Prompt for flags one at a time',
  })
  protected region = Option.String('-r,--region', {
    description: 'GCP region your service(s) are deployed in',
  })
  protected logLevel = Option.String('--log-level,--logLevel')
  protected sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', true, {
    description:
      'Enable source code integration to add git metadata as tags. Defaults to enabled. Specify `--no-source-code-integration` to disable.',
  })
  protected uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', true, {
    description: 'Upload git metadata to Datadog. Defaults to enabled. Specify `--no-upload-git-metadata` to disable.',
  })
  protected tracing = Option.String('--tracing')
  protected version = Option.String('--version')
  protected llmobs = Option.String('--llmobs')
  protected healthCheckPort = Option.String('--port,--health-check-port,--healthCheckPort')
  protected sidecarImage = Option.String('--image,--sidecar-image', DEFAULT_SIDECAR_IMAGE, {
    description: `The image to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_IMAGE}'`,
  })
  protected sidecarName = Option.String('--sidecar-name', DEFAULT_SIDECAR_NAME, {
    description: `(Not recommended) The name to use for the sidecar container. Defaults to '${DEFAULT_SIDECAR_NAME}'`,
  })
  protected sharedVolumeName = Option.String('--shared-volume-name', DEFAULT_VOLUME_NAME, {
    description: `(Not recommended) The name to use for the shared volume. Defaults to '${DEFAULT_VOLUME_NAME}'`,
  })
  protected sharedVolumePath = Option.String('--shared-volume-path', DEFAULT_VOLUME_PATH, {
    description: `(Not recommended) The path to use for the shared volume. Defaults to '${DEFAULT_VOLUME_PATH}'`,
  })
  protected logsPath = Option.String('--logs-path', DEFAULT_LOGS_PATH, {
    description: `(Not recommended) The path to use for the logs. Defaults to '${DEFAULT_LOGS_PATH}'. Must begin with the shared volume path.`,
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
