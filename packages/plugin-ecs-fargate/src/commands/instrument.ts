import type {InstrumentSettings} from '../task-definition'
import type {ECSClient} from '@aws-sdk/client-ecs'
import type {EcsFargateConfigOptions} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'

import {EcsFargateInstrumentCommand} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff, parseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {AGENT_IMAGE, API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'

import {
  createECSClient,
  describeTaskDefinition,
  getAWSCredentials,
  getAWSProfileCredentials,
  registerTaskDefinition,
} from '../aws'
import {AWS_REGION_ENV_VARS} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields} from '../task-definition'

export class PluginCommand extends EcsFargateInstrumentCommand {
  public async execute(): Promise<0 | 1> {
    this.enableFips()

    const [config, configErrors] = await this.ensureConfig()
    if (configErrors.length > 0) {
      for (const error of configErrors) {
        this.context.stdout.write(renderError(error))
      }

      return 1
    }

    const region = config.region ?? AWS_REGION_ENV_VARS.map((envVar) => process.env[envVar]).find((value) => !!value)
    if (!region) {
      this.context.stdout.write(
        renderError(
          `No region specified. Use --region or set the ${AWS_REGION_ENV_VARS.join(' or ')} environment variable.`
        )
      )

      return 1
    }

    const apiKey = await this.resolveApiKey(config)
    if (!apiKey) {
      return 1
    }

    if (config.sourceCodeIntegration ?? true) {
      // The git tags are still resolved on a dry run, so the diff shows the DD_TAGS a real run would
      // write. Uploading the metadata is a write to Datadog, which a dry run must not make.
      config.extraTags = await handleSourceCodeIntegration(
        this.context,
        !this.dryRun && (config.uploadGitMetadata ?? true),
        config.extraTags
      )
    }

    const settings: InstrumentSettings = {...this.buildSettings(config), ...apiKey}

    let client: ECSClient
    try {
      const credentials = config.profile ? await getAWSProfileCredentials(config.profile) : await getAWSCredentials()
      client = createECSClient(region, credentials)
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return 1
    }

    let instrumented = true
    for (const taskDefinition of config.taskDefinitions ?? []) {
      instrumented = (await this.instrument(client, taskDefinition, settings)) && instrumented
    }

    return instrumented ? 0 : 1
  }

  /**
   * Instruments one task definition, reporting what it did or what stopped it.
   *
   * A task definition that cannot be instrumented does not stop the others: a run over several of
   * them reports every problem rather than the first one.
   *
   * @returns whether the task definition is instrumented.
   */
  private async instrument(client: ECSClient, target: string, settings: InstrumentSettings): Promise<boolean> {
    try {
      const {taskDefinition, tags} = await describeTaskDefinition(client, target)
      const family = taskDefinition.family ?? target

      const {taskDefinition: updated, warnings} = instrumentTaskDefinition(taskDefinition, settings, tags)
      for (const warning of warnings) {
        this.context.stdout.write(renderSoftWarning(warning))
      }

      const original = {...stripReadOnlyFields(taskDefinition), tags}
      if (isUpToDate(original, updated)) {
        this.context.stdout.write(
          `${this.dryRunPrefix}${chalk.bold(family)} is already instrumented, no changes needed.\n`
        )

        return true
      }

      this.context.stdout.write(
        `${this.dryRunPrefix}Instrumenting ${chalk.bold(family)}:\n${generateConfigDiff(original, updated)}\n`
      )

      if (this.dryRun) {
        return true
      }

      const registered = await registerTaskDefinition(client, updated)
      this.context.stdout.write(
        `Registered ${chalk.bold(`${family}:${registered.revision}`)}. Update your services and tasks to this revision to roll out the change.\n`
      )

      return true
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return false
    }
  }

  /**
   * What the task definitions are instrumented with, leaving aside how the Agent gets its API key.
   */
  private buildSettings(config: EcsFargateConfigOptions): InstrumentSettings {
    return {
      agentImage: config.agentImage ?? AGENT_IMAGE,
      site: getDatadogSite(),
      service: config.service,
      environment: config.environment,
      version: config.version,
      extraTags: config.extraTags,
      envVars: parseEnvVars(config.envVars),
      tracing: toBoolean(config.tracing),
      logLevel: config.logLevel,
      appsec: config.appsec,
      llmobs: config.llmobs,
    }
  }

  /**
   * How the Agent reads the API key: a Secrets Manager reference, or the key itself.
   *
   * Reports why it cannot be resolved and returns `undefined`, before the command does any work that
   * would have to be undone.
   */
  private async resolveApiKey(
    config: EcsFargateConfigOptions
  ): Promise<Pick<InstrumentSettings, 'apiKey' | 'apiKeySecretArn'> | undefined> {
    if (config.apiKeySecretArn) {
      return {apiKeySecretArn: config.apiKeySecretArn}
    }

    const apiKey = process.env[CI_API_KEY_ENV_VAR] || process.env[API_KEY_ENV_VAR]
    if (!apiKey) {
      this.context.stdout.write(
        renderError(
          `No Datadog API key found. Pass --api-key-secret-arn, or set the ${API_KEY_ENV_VAR} environment variable.`
        )
      )

      return undefined
    }

    if (!(await this.isApiKeyValid(apiKey))) {
      return undefined
    }

    this.context.stdout.write(
      renderSoftWarning(
        `Writing the ${API_KEY_ENV_VAR} from your environment into the task definition in plain text. Pass --api-key-secret-arn to reference an AWS Secrets Manager secret instead.`
      )
    )

    return {apiKey}
  }

  /**
   * Whether the API key works, checked before it is written into a task definition so that a key
   * that cannot report telemetry is caught here rather than in a running task.
   *
   * A key held in Secrets Manager is not read by this command, so it goes unchecked.
   */
  private async isApiKeyValid(apiKey: string): Promise<boolean> {
    try {
      if (await newApiKeyValidator({apiKey, datadogSite: getDatadogSite()}).validateApiKey()) {
        return true
      }
    } catch (error) {
      this.context.stdout.write(
        renderError(`Could not validate the Datadog API key: ${error instanceof Error ? error.message : String(error)}`)
      )

      return false
    }

    this.context.stdout.write(
      renderError(
        `Invalid Datadog API key: ${maskString(apiKey)}\nEnsure you copied the value and not the Key ID, and that it belongs to ${getDatadogSite()}.`
      )
    )

    return false
  }
}
