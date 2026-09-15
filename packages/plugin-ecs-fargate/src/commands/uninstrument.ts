import type {App} from '../apps'
import type {UninstrumentSettings} from '../task-definition'
import type {ECSClient} from '@aws-sdk/client-ecs'

import {EcsFargateUninstrumentCommand} from '@datadog/datadog-ci-base/commands/ecs-fargate/uninstrument'
import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {generateConfigDiff, parseEnvVars, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import chalk from 'chalk'

import {deployService, resolveApps} from '../apps'
import {
  createECSClient,
  describeTaskDefinition,
  getAWSCredentials,
  getAWSProfileCredentials,
  registerTaskDefinition,
} from '../aws'
import {AWS_REGION_ENV_VARS} from '../constants'
import {stripReadOnlyFields, uninstrumentTaskDefinition, withMaskedApiKey} from '../task-definition'

export class PluginCommand extends EcsFargateUninstrumentCommand {
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

    const settings: UninstrumentSettings = {envVars: parseEnvVars(config.envVars)}

    let client: ECSClient
    try {
      const credentials = config.profile ? await getAWSProfileCredentials(config.profile) : await getAWSCredentials()
      client = createECSClient(region, credentials)
    } catch (error) {
      this.context.stdout.write(renderError(error instanceof Error ? error.message : error))

      return 1
    }

    const [apps, resolutionErrors] = await resolveApps(client, config, 'uninstrument')
    for (const error of resolutionErrors) {
      this.context.stdout.write(renderError(error))
    }

    const results = await Promise.all(apps.map((app) => this.processApp(client, config.cluster, app, settings)))

    return resolutionErrors.length > 0 || results.some((result) => !result) ? 1 : 0
  }

  /**
   * Reverts one app's task definition and points its services at the revision that comes out.
   *
   * @returns whether the app was uninstrumented and every one of its services runs the new revision.
   */
  private async processApp(
    client: ECSClient,
    cluster: string | undefined,
    app: App,
    settings: UninstrumentSettings
  ): Promise<boolean> {
    const output: string[] = []
    try {
      const taskDefinitionArn = await this.uninstrument(client, app, settings, output)
      const deployed = await Promise.all(
        app.services.map((service) =>
          deployService({
            client,
            cluster,
            service,
            app,
            taskDefinitionArn,
            dryRun: this.dryRun,
            dryRunPrefix: this.dryRunPrefix,
            output,
          })
        )
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
   * Reverts instrumentation on the app's task definition, reporting what it did.
   *
   * @returns the ARN of the revision the app's services should be pointed at, or `undefined` on a
   * dry run, which registers none.
   */
  private async uninstrument(
    client: ECSClient,
    app: App,
    settings: UninstrumentSettings,
    output: string[]
  ): Promise<string | undefined> {
    const {taskDefinition, tags} = await describeTaskDefinition(client, app.target)
    const family = taskDefinition.family ?? app.target

    const {taskDefinition: updated, warnings} = uninstrumentTaskDefinition(taskDefinition, settings, tags)
    for (const warning of warnings) {
      output.push(renderSoftWarning(warning))
    }

    // Compared in full rather than through `isUpToDate`, which ignores the tag recording the CLI
    // version: here that tag is one of the things to remove, so a revision carrying nothing but it
    // still gets a clean one registered.
    const original = {...stripReadOnlyFields(taskDefinition), tags}
    if (sortedEqual(original, updated)) {
      output.push(`${this.dryRunPrefix}${chalk.bold(family)} is not instrumented, no changes needed.\n`)

      return taskDefinition.taskDefinitionArn
    }

    // The revision being reverted holds a plaintext API key whenever it was instrumented without
    // `--api-key-secret-arn`, and the diff prints it, so both sides are masked.
    output.push(
      `${this.dryRunPrefix}Uninstrumenting ${chalk.bold(family)}:\n${generateConfigDiff(
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
}
