import type {ContainerAppConfigOptions} from './common'

import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {executePluginCommand} from '../../helpers/plugin'
import {
  DEFAULT_VOLUME_PATH,
  DEFAULT_LOGS_PATH,
  DEFAULT_VOLUME_NAME,
  DEFAULT_SIDECAR_NAME,
  SIDECAR_IMAGE,
} from '../../helpers/serverless/constants'
import {DEFAULT_TRACER_LIBC, LIBCS} from '../../helpers/serverless/ssi/injection-spec'
import {
  DEFAULT_TRACER_VERSION,
  TRACER_IMAGE_TAG_REG_EXP,
  TRACER_INJECTION_LANGUAGES,
} from '../../helpers/serverless/ssi/tracer'
import {TRACING_MODES} from '../../helpers/serverless/ssi/tracing'

import {ContainerAppCommand} from './common'

export const DEFAULT_SIDECAR_CPU = 0.5
export const DEFAULT_SIDECAR_MEMORY = 1

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
  private sidecarCpu = Option.String('--sidecar-cpu', {
    description: `The number of CPUs to allocate to the sidecar container. Defaults to '${DEFAULT_SIDECAR_CPU}'.`,
    validator: t.isNumber(),
  })
  private sidecarMemory = Option.String('--sidecar-memory', {
    description: `The amount of memory (in GiB) to allocate to the sidecar container. Defaults to '${DEFAULT_SIDECAR_MEMORY}'.`,
    validator: t.isNumber(),
  })
  private sidecarImage = Option.String('--sidecar-image', SIDECAR_IMAGE, {
    description: `Override to pin a specific version tag or to use a mirrored image from a custom registry (e.g., ACR) to avoid pull rate limits. Defaults to '${SIDECAR_IMAGE}'`,
  })
  private tracing: ContainerAppConfigOptions['tracing'] = Option.String('--tracing', {
    description:
      'Configure APM instrumentation. Use `manual` when the tracer is installed, `inject` with `--language` for automatic instrumentation, or `disabled` to turn tracing off. Defaults to `manual`.',
    validator: t.isEnum(TRACING_MODES),
  })
  private language: ContainerAppConfigOptions['language'] = Option.String('--language', {
    description: `Set the application language for log parsing. With \`--tracing inject\`, this selects a supported tracer. Supported injection values: ${TRACER_INJECTION_LANGUAGES.map(
      (language) => `\`${language}\``
    ).join(', ')}.`,
    validator: t.cascade(t.isString(), t.matchesRegExp(/.+/)),
  })
  private tracerVersion = Option.String('--tracer-version', {
    description: `Set the tracer image tag for automatic instrumentation. Defaults to '${DEFAULT_TRACER_VERSION}'.`,
    validator: t.cascade(t.isString(), t.matchesRegExp(TRACER_IMAGE_TAG_REG_EXP)),
  })
  private tracerLibc: ContainerAppConfigOptions['tracerLibc'] = Option.String('--tracer-libc', {
    description: `Set the C standard library used by the application image. Possible values: ${LIBCS.map(
      (libc) => `"${libc}"`
    ).join(', ')}. Defaults to '${DEFAULT_TRACER_LIBC}'.`,
    validator: t.isEnum(LIBCS),
  })
  private containerName = Option.String('--container-name', {
    description:
      'Select the application container to instrument when the Container App has multiple application containers.',
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
      sidecarImage: this.sidecarImage,
      tracing: this.tracing,
      language: this.language,
      tracerVersion: this.tracerVersion,
      tracerLibc: this.tracerLibc,
      containerName: this.containerName,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      extraTags: this.extraTags,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
