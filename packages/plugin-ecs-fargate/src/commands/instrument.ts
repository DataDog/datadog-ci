import type {InstrumentSettings} from '../task-definition'
import type {ECSClient} from '@aws-sdk/client-ecs'
import type {EcsFargateConfigOptions} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'

import {EcsFargateInstrumentCommand} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {maskString} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'

import {
  createECSClient,
  describeService,
  describeTaskDefinition,
  getAWSCredentials,
  getAWSProfileCredentials,
  registerTaskDefinition,
  taskDefinitionFamily,
  taskDefinitionRevision,
  updateServiceTaskDefinition,
} from '../aws'
import {AWS_REGION_ENV_VARS} from '../constants'
import {instrumentTaskDefinition, isUpToDate, stripReadOnlyFields, withMaskedApiKey} from '../task-definition'

/**
 * A task definition this run instrumented, and the revision the ECS services running that family
 * should be pointed at.
 */
type InstrumentedRevision = {
  family: string
  /** Absent on a dry run, which registers no revision to point a service at. */
  taskDefinitionArn?: string
}

/**
 * The revisions to deploy, by family. `ensureConfig` rejects a run naming a family twice, so there
 * is one revision per family and a service running that family has a single revision to be pointed
 * at rather than whichever one happened to be instrumented first.
 */
type InstrumentedRevisions = Map<string, InstrumentedRevision>

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

    const settings: InstrumentSettings = {...this.buildSettings(config), ...apiKey}

    let client: ECSClient
    try {
      const credentials = config.profile ? await getAWSProfileCredentials(config.profile) : await getAWSCredentials()
      client = createECSClient(region, credentials)
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return 1
    }

    const services = config.ecsServices ?? []
    const instrumented: InstrumentedRevisions = new Map()
    let failed = false
    for (const taskDefinition of config.taskDefinitions ?? []) {
      const revision = await this.instrument(client, taskDefinition, settings, services.length > 0)
      if (revision) {
        instrumented.set(revision.family, revision)
      } else {
        failed = true
      }
    }

    if (failed) {
      // Deploying changes what is running, so a run that could not instrument every task definition
      // stops here rather than pointing some of the services at a new revision.
      return 1
    }

    if (services.length > 0 && !(await this.deploy(client, config.cluster, services, instrumented))) {
      return 1
    }

    return 0
  }

  /**
   * Instruments one task definition, reporting what it did or what stopped it.
   *
   * A task definition that cannot be instrumented does not stop the others: a run over several of
   * them reports every problem rather than the first one.
   *
   * @returns the revision the services running the family should be pointed at, or `undefined` if
   * the task definition could not be instrumented.
   */
  private async instrument(
    client: ECSClient,
    target: string,
    settings: InstrumentSettings,
    deployed: boolean
  ): Promise<InstrumentedRevision | undefined> {
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

        return {family, taskDefinitionArn: taskDefinition.taskDefinitionArn}
      }

      this.context.stdout.write(
        `${this.dryRunPrefix}Instrumenting ${chalk.bold(family)}:\n${generateConfigDiff(
          withMaskedApiKey(original),
          withMaskedApiKey(updated)
        )}\n`
      )

      if (this.dryRun) {
        return {family}
      }

      const registered = await registerTaskDefinition(client, updated)
      const rollout = deployed ? '' : ' Update your services and tasks to this revision to roll out the change.'
      this.context.stdout.write(`Registered ${chalk.bold(`${family}:${registered.revision}`)}.${rollout}\n`)

      return {family, taskDefinitionArn: registered.taskDefinitionArn}
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return undefined
    }
  }

  /**
   * Points each named ECS service at the instrumented revision of the task definition family it
   * runs, so that the change reaches the running tasks without a manual deployment.
   *
   * A service that cannot be updated does not stop the others: a run over several of them reports
   * every problem rather than the first one.
   *
   * @returns whether every service runs an instrumented revision.
   */
  private async deploy(
    client: ECSClient,
    cluster: string | undefined,
    services: string[],
    instrumented: InstrumentedRevisions
  ): Promise<boolean> {
    let deployed = true
    for (const name of services) {
      try {
        const service = await describeService(client, cluster, name)
        const family = taskDefinitionFamily(service.taskDefinition)
        const target = instrumented.get(family)
        if (!target) {
          throw Error(
            `${name} runs ${family}, which this run did not instrument. Pass --task-definition ${family} to instrument it.`
          )
        }

        if (!target.taskDefinitionArn) {
          // Only a dry run gets here, since it registers no revision to point the service at.
          this.context.stdout.write(
            `${this.dryRunPrefix}Updating ${chalk.bold(name)} to the new ${chalk.bold(family)} revision.\n`
          )
          continue
        }

        const revision = taskDefinitionRevision(target.taskDefinitionArn)
        if (service.taskDefinition === target.taskDefinitionArn) {
          this.context.stdout.write(`${chalk.bold(name)} already runs ${chalk.bold(revision)}, no deployment needed.\n`)
          continue
        }

        this.context.stdout.write(
          `${this.dryRunPrefix}Updating ${chalk.bold(name)} to ${chalk.bold(revision)}. ECS rolls the revision out to the tasks the service is running.\n`
        )

        if (!this.dryRun) {
          await updateServiceTaskDefinition(client, cluster, name, target.taskDefinitionArn)
        }
      } catch (error) {
        this.context.stdout.write(renderError(error instanceof Error ? error.message : error))
        deployed = false
      }
    }

    return deployed
  }

  /**
   * What the task definitions are instrumented with, leaving aside how the Agent gets its API key.
   */
  private buildSettings(config: EcsFargateConfigOptions): InstrumentSettings {
    return {
      agentImage: config.agentImage,
      site: getDatadogSite(),
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
