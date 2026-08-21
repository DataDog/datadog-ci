import type {InstrumentSettings} from '../task-definition'

import {EcsFargateInstrumentCommand} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import chalk from 'chalk'

import {
  createECSClient,
  describeTaskDefinition,
  getAWSCredentials,
  getAWSProfileCredentials,
  registerTaskDefinition,
} from '../aws'
import {AWS_REGION_ENV_VARS, DEFAULT_AGENT_IMAGE} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields} from '../task-definition'

export class PluginCommand extends EcsFargateInstrumentCommand {
  public async execute(): Promise<0 | 1> {
    this.enableFips()

    const region = this.region ?? AWS_REGION_ENV_VARS.map((envVar) => process.env[envVar]).find((value) => !!value)
    if (!region) {
      this.context.stdout.write(
        renderError(
          `No region specified. Use --region or set the ${AWS_REGION_ENV_VARS.join(' or ')} environment variable.`
        )
      )

      return 1
    }

    const settings = this.resolveSettings()
    if (!settings) {
      return 1
    }

    try {
      const credentials = this.profile ? await getAWSProfileCredentials(this.profile) : await getAWSCredentials()
      const client = createECSClient(region, credentials)

      const {taskDefinition, tags} = await describeTaskDefinition(client, this.taskDefinition)
      const family = taskDefinition.family ?? this.taskDefinition

      const {taskDefinition: updated, warnings} = instrumentTaskDefinition(taskDefinition, settings, tags)
      for (const warning of warnings) {
        this.context.stdout.write(renderSoftWarning(warning))
      }

      const original = {...stripReadOnlyFields(taskDefinition), tags}
      if (isUpToDate(original, updated)) {
        this.context.stdout.write(
          `${this.dryRunPrefix}${chalk.bold(family)} is already instrumented, no changes needed.\n`
        )

        return 0
      }

      this.context.stdout.write(
        `${this.dryRunPrefix}Instrumenting ${chalk.bold(family)}:\n${generateConfigDiff(original, updated)}\n`
      )

      if (this.dryRun) {
        return 0
      }

      const registered = await registerTaskDefinition(client, updated)
      this.context.stdout.write(
        `Registered ${chalk.bold(`${family}:${registered.revision}`)}. Update your services and tasks to this revision to roll out the change.\n`
      )

      return 0
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return 1
    }
  }

  /**
   * Resolves what to instrument with, or reports why it cannot and returns `undefined`.
   */
  private resolveSettings(): InstrumentSettings | undefined {
    if (this.apiKeySecretArn) {
      return {agentImage: DEFAULT_AGENT_IMAGE, site: getDatadogSite(), apiKeySecretArn: this.apiKeySecretArn}
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

    this.context.stdout.write(
      renderSoftWarning(
        `Writing the ${API_KEY_ENV_VAR} from your environment into the task definition in plain text. Pass --api-key-secret-arn to reference an AWS Secrets Manager secret instead.`
      )
    )

    return {agentImage: DEFAULT_AGENT_IMAGE, site: getDatadogSite(), apiKey}
  }
}
