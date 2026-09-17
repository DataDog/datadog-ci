import type {DescribedService} from './aws'
import type {ECSClient} from '@aws-sdk/client-ecs'
import type {EcsFargateConfigOptions} from '@datadog/datadog-ci-base/commands/ecs-fargate/common'

import {renderError} from '@datadog/datadog-ci-base/helpers/renderer'
import chalk from 'chalk'

import {describeService, taskDefinitionFamily, taskDefinitionRevision, updateServiceTaskDefinition} from './aws'

/**
 * One application a run acts on: the task definition to rewrite, and the ECS services running it
 * that should be pointed at the revision it registers.
 *
 * An app is rewritten and rolled out on its own, so one that cannot be handled reports why and
 * leaves the others to finish.
 */
export type App = {
  /** What `--task-definition` named: a family, `family:revision`, or a task definition ARN. */
  target: string
  family: string
  /** Empty when no `--ecs-service` names a service running this family. */
  services: DescribedService[]
}

/**
 * The apps a run acts on, along with everything that stopped a service from being paired with one.
 *
 * The pairing happens before anything is registered, so a service running a family the run does not
 * cover is reported rather than being discovered once a revision already exists.
 *
 * @param action what the run does to a task definition, which names what a service the run does not
 * cover is missing out on.
 * @returns the apps to process, and the problems to report. A service that could not be paired is
 * reported without blocking succesful pairs.
 */
export const resolveApps = async (
  client: ECSClient,
  config: EcsFargateConfigOptions,
  action: 'instrument' | 'uninstrument'
): Promise<[App[], string[]]> => {
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
        `${service.name} runs ${family}, which this run does not ${action}. Pass --task-definition ${family} to ${action} it.`
      )
      continue
    }

    app.services.push(service)
  }

  return [[...apps.values()], errors]
}

/**
 * What pointing one service at a new revision needs to know.
 */
type DeployServiceContext = {
  client: ECSClient
  cluster: string | undefined
  service: DescribedService
  app: App
  /** The revision to point the service at, or `undefined` on a dry run, which registers none. */
  taskDefinitionArn: string | undefined
  dryRun: boolean
  dryRunPrefix: string
  /** What the run reports, collected so that one app's output is not interleaved with another's. */
  output: string[]
}

/**
 * Points one service at the new revision of the family it runs, so that the change reaches the
 * running tasks without a manual deployment.
 *
 * A service that cannot be updated does not block others.
 *
 * @returns whether the service runs the new revision.
 */
export const deployService = async ({
  client,
  cluster,
  service,
  app,
  taskDefinitionArn,
  dryRun,
  dryRunPrefix,
  output,
}: DeployServiceContext): Promise<boolean> => {
  try {
    if (!taskDefinitionArn) {
      // Only a dry run gets here, since it registers no revision to point the service at.
      output.push(
        `${dryRunPrefix}Updating ${chalk.bold(service.name)} to the new ${chalk.bold(app.family)} revision.\n`
      )

      return true
    }

    const revision = taskDefinitionRevision(taskDefinitionArn)
    if (service.taskDefinition === taskDefinitionArn) {
      output.push(`${chalk.bold(service.name)} already runs ${chalk.bold(revision)}, no deployment needed.\n`)

      return true
    }

    output.push(
      `${dryRunPrefix}Updating ${chalk.bold(service.name)} to ${chalk.bold(
        revision
      )}. ECS rolls the revision out to the tasks the service is running.\n`
    )

    if (!dryRun) {
      await updateServiceTaskDefinition(client, cluster, service.name, taskDefinitionArn)
    }

    return true
  } catch (error) {
    output.push(renderError(error instanceof Error ? error.message : error))

    return false
  }
}
