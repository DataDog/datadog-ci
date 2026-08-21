import type {DescribedService} from '../aws'
import type {InstrumentSettings} from '../task-definition'
import type {ECSClient} from '@aws-sdk/client-ecs'
import type {EcsFargateConfigOptions} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'

import {EcsFargateInstrumentCommand} from '@datadog/datadog-ci-base/commands/ecs-fargate/instrument'
import {getDatadogSite} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff, parseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {handleSourceCodeIntegration} from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
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
 * One application this run acts on: the task definition to instrument, and the ECS services running
 * it that should be pointed at the revision it registers.
 *
 * An app is instrumented and rolled out on its own, so one that cannot be handled reports why and
 * leaves the others to finish.
 */
type App = {
  /** What `--task-definition` named: a family, `family:revision`, or a task definition ARN. */
  target: string
  family: string
  /** Empty when no `--ecs-service` names a service running this family. */
  services: DescribedService[]
}

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

    const [apps, resolutionErrors] = await this.resolveApps(client, config)
    for (const error of resolutionErrors) {
      this.context.stdout.write(renderError(error))
    }

    const results = await Promise.all(apps.map((app) => this.processApp(client, config.cluster, app, settings)))

    return resolutionErrors.length > 0 || results.some((result) => !result) ? 1 : 0
  }

  /**
   * The apps this run acts on, along with everything that stopped a service from being paired with
   * one.
   *
   * The pairing happens before anything is registered, so a service running a family the run does
   * not instrument is reported rather than being discovered once a revision already exists.
   *
   * @returns the apps to process, and the problems to report. A service that could not be paired is
   * reported without blocking succesful pairs.
   */
  private async resolveApps(client: ECSClient, config: EcsFargateConfigOptions): Promise<[App[], string[]]> {
    // `ensureConfig` rejects a run naming a family twice, so keying by family gives one app per
    // family and a service running that family has a single revision to be pointed at.
    const apps = new Map<string, App>(
      (config.taskDefinitions ?? []).map((target) => {
        const family = taskDefinitionFamily(target)

        return [family, {target, family, services: []}]
      })
    )

    const errors: string[] = []
    const described = await Promise.allSettled(
      (config.ecsServices ?? []).map((name) => describeService(client, config.cluster, name))
    )

    for (const result of described) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason
        errors.push(reason instanceof Error ? reason.message : String(reason))
        continue
      }

      const service = result.value
      const family = taskDefinitionFamily(service.taskDefinition)
      const app = apps.get(family)
      if (!app) {
        errors.push(
          `${service.name} runs ${family}, which this run does not instrument. Pass --task-definition ${family} to instrument it.`
        )
        continue
      }

      app.services.push(service)
    }

    return [[...apps.values()], errors]
  }

  /**
   * Instruments one app's task definition and points its services at the revision that comes out.
   *
   * @returns whether the app was instrumented and every one of its services runs the new revision.
   */
  private async processApp(
    client: ECSClient,
    cluster: string | undefined,
    app: App,
    settings: InstrumentSettings
  ): Promise<boolean> {
    const output: string[] = []
    try {
      const taskDefinitionArn = await this.instrument(client, app, settings, output)
      const deployed = await Promise.all(
        app.services.map((service) => this.deployService(client, cluster, service, app, taskDefinitionArn, output))
      )

      return deployed.every((result) => result)
    } catch (error) {
      output.push(renderError(error instanceof Error ? error.message : error))

      return false
    } finally {
      this.context.stdout.write(output.join(''))
    }
  }

  /**
   * Instruments the app's task definition, reporting what it did.
   *
   * @returns the ARN of the revision the app's services should be pointed at, or `undefined` on a
   * dry run, which registers none.
   */
  private async instrument(
    client: ECSClient,
    app: App,
    settings: InstrumentSettings,
    output: string[]
  ): Promise<string | undefined> {
    const {taskDefinition, tags} = await describeTaskDefinition(client, app.target)
    const family = taskDefinition.family ?? app.target

    const {taskDefinition: updated, warnings} = instrumentTaskDefinition(taskDefinition, settings, tags)
    for (const warning of warnings) {
      output.push(renderSoftWarning(warning))
    }

    const original = {...stripReadOnlyFields(taskDefinition), tags}
    if (isUpToDate(original, updated)) {
      output.push(`${this.dryRunPrefix}${chalk.bold(family)} is already instrumented, no changes needed.\n`)

      return taskDefinition.taskDefinitionArn
    }

    output.push(
      `${this.dryRunPrefix}Instrumenting ${chalk.bold(family)}:\n${generateConfigDiff(
        withMaskedApiKey(original),
        withMaskedApiKey(updated)
      )}\n`
    )

    if (this.dryRun) {
      return undefined
    }

    const registered = await registerTaskDefinition(client, updated)
    const rollout =
      app.services.length > 0 ? '' : ' Update your services and tasks to this revision to roll out the change.'
    output.push(`Registered ${chalk.bold(`${family}:${registered.revision}`)}.${rollout}\n`)

    return registered.taskDefinitionArn
  }

  /**
   * Points one service at the instrumented revision of the family it runs, so that the change
   * reaches the running tasks without a manual deployment.
   *
   * A service that cannot be updated does not block others.
   *
   * @returns whether the service runs an instrumented revision.
   */
  private async deployService(
    client: ECSClient,
    cluster: string | undefined,
    service: DescribedService,
    app: App,
    taskDefinitionArn: string | undefined,
    output: string[]
  ): Promise<boolean> {
    try {
      if (!taskDefinitionArn) {
        // Only a dry run gets here, since it registers no revision to point the service at.
        output.push(
          `${this.dryRunPrefix}Updating ${chalk.bold(service.name)} to the new ${chalk.bold(app.family)} revision.\n`
        )

        return true
      }

      const revision = taskDefinitionRevision(taskDefinitionArn)
      if (service.taskDefinition === taskDefinitionArn) {
        output.push(`${chalk.bold(service.name)} already runs ${chalk.bold(revision)}, no deployment needed.\n`)

        return true
      }

      output.push(
        `${this.dryRunPrefix}Updating ${chalk.bold(service.name)} to ${chalk.bold(revision)}. ECS rolls the revision out to the tasks the service is running.\n`
      )

      if (!this.dryRun) {
        await updateServiceTaskDefinition(client, cluster, service.name, taskDefinitionArn)
      }

      return true
    } catch (error) {
      output.push(renderError(error instanceof Error ? error.message : error))

      return false
    }
  }

  /**
   * What the task definitions are instrumented with, leaving aside how the Agent gets its API key.
   */
  private buildSettings(config: EcsFargateConfigOptions): InstrumentSettings {
    return {
      agentImage: config.agentImage,
      agentSocket: config.agentSocket ?? true,
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
