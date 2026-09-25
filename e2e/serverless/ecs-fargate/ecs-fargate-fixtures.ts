import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {ExecResult} from '../../helpers/exec'
import {execPromise, execPromiseWithRetries, execSync} from '../../helpers/exec'

export const APP_CONTAINER_NAME = 'app'
export const APP_CONTAINER_PORT = 8080

export const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1'

/**
 * The account resources the suite runs against, provisioned outside this repository. Read lazily so
 * that the task definition tests, which need only the roles, do not fail on a missing cluster.
 */
export const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set to run ECS Fargate e2e tests`)
  }

  return value
}

export const runId = (): string => crypto.randomBytes(4).toString('hex')

export const familyFor = (suffix: string): string => `one-e2e-ci-ecsf-${suffix}`

export const appImageFor = (fixtureImageName: string): string =>
  `${requireEnv('AWS_ECS_APP_IMAGE_REGISTRY')}/${fixtureImageName}:latest`

export const expectCommandToSucceed = (description: string, result: ExecResult): void => {
  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed (exit code ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    )
  }
}

/** The shape of an AWS CLI `--output json` response, declared by the caller that reads it. */
export const parseJson = <T>(output: string): T => JSON.parse(output) as T

interface TaskDefinitionOptions {
  family: string
  image: string
  containerName?: string
  /**
   * Left off to exercise the command's refusal to reference a Secrets Manager secret from a task
   * definition ECS could not resolve it with.
   */
  withExecutionRole?: boolean
}

/**
 * A minimal Fargate task definition the commands accept: `awsvpc` networking, a FARGATE
 * compatibility, an execution role so a secret reference can resolve, and a task role so the Agent
 * can read task metadata.
 */
const buildTaskDefinition = ({
  family,
  image,
  containerName = APP_CONTAINER_NAME,
  withExecutionRole = true,
}: TaskDefinitionOptions): Record<string, unknown> => ({
  family,
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '512',
  memory: '1024',
  ...(withExecutionRole ? {executionRoleArn: requireEnv('AWS_ECS_EXECUTION_ROLE_ARN')} : {}),
  taskRoleArn: requireEnv('AWS_ECS_TASK_ROLE_ARN'),
  containerDefinitions: [
    {
      name: containerName,
      image,
      essential: true,
      portMappings: [{containerPort: APP_CONTAINER_PORT, protocol: 'tcp'}],
      // The awslogs driver resolves through the execution role, so a task definition deliberately
      // registered without one carries no log configuration either.
      ...(withExecutionRole
        ? {
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': requireEnv('AWS_ECS_LOG_GROUP'),
                'awslogs-region': region,
                'awslogs-stream-prefix': family,
              },
            },
          }
        : {}),
    },
  ],
  tags: [{key: 'one_e2e_created', value: Math.floor(Date.now() / 1000).toString()}],
})

export interface RegisteredTaskDefinition {
  family: string
  revision: number
  taskDefinitionArn: string
}

/**
 * Registers a task definition through a temporary file, since the container definitions are too
 * nested for the CLI's shorthand syntax.
 */
const registerTaskDefinition = async (definition: Record<string, unknown>): Promise<RegisteredTaskDefinition> => {
  const family = definition.family as string
  const inputPath = path.join(os.tmpdir(), `${family}-${crypto.randomBytes(4).toString('hex')}.json`)
  fs.writeFileSync(inputPath, JSON.stringify(definition))

  try {
    const result = await execPromiseWithRetries(
      `aws ecs register-task-definition --cli-input-json "file://${inputPath}" --region "${region}" --output json`
    )
    expectCommandToSucceed(`Registering task definition ${family}`, result)
    const {taskDefinition} = parseJson<{taskDefinition: RegisteredTaskDefinition}>(result.stdout)

    return taskDefinition
  } finally {
    try {
      fs.unlinkSync(inputPath)
    } catch (error) {
      console.error(`Failed to delete temp file ${inputPath}:`, error)
    }
  }
}

/** Registers the standard fixture task definition and returns its first revision. */
export const registerBaseTaskDefinition = async (options: TaskDefinitionOptions): Promise<RegisteredTaskDefinition> =>
  registerTaskDefinition(buildTaskDefinition(options))

/**
 * The active revisions of one family, oldest first. `--family-prefix` is a prefix match, so the
 * results are narrowed to the exact family.
 */
const listRevisions = (family: string): string[] => {
  const {taskDefinitionArns = []} = parseJson<{taskDefinitionArns?: string[]}>(
    execSync(`aws ecs list-task-definitions --family-prefix "${family}" --region "${region}" --output json`)
  )

  return taskDefinitionArns.filter((arn) => arn.split('/').pop()?.split(':')[0] === family)
}

export const latestRevision = (family: string): number => {
  const revisions = listRevisions(family)
  if (revisions.length === 0) {
    throw new Error(`No revisions found for task definition family ${family}`)
  }

  return Number(revisions[revisions.length - 1].split(':').pop())
}

/**
 * Deregisters every revision of a family. Families are unique per run, so this leaves nothing of the
 * run behind without touching anything else in the account.
 */
export const deregisterFamily = async (family: string): Promise<void> => {
  let revisions: string[]
  try {
    revisions = listRevisions(family)
  } catch (error) {
    console.error(`Failed to list revisions of ${family}:`, error)

    return
  }

  for (const arn of revisions) {
    const result = await execPromise(
      `aws ecs deregister-task-definition --task-definition "${arn}" --region "${region}" --output text`
    )
    if (result.exitCode !== 0) {
      console.error(`Failed to deregister ${arn}: ${result.stderr}`)
    }
  }
}

export const createFargateService = async (serviceName: string, taskDefinitionArn: string): Promise<void> => {
  const subnets = requireEnv('AWS_ECS_SUBNETS')
  const securityGroup = requireEnv('AWS_ECS_SECURITY_GROUP')
  const result = await execPromiseWithRetries(
    `aws ecs create-service` +
      ` --cluster "${requireEnv('AWS_ECS_CLUSTER')}"` +
      ` --service-name "${serviceName}"` +
      ` --task-definition "${taskDefinitionArn}"` +
      ` --desired-count 1` +
      ` --launch-type FARGATE` +
      ` --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${securityGroup}],assignPublicIp=ENABLED}"` +
      ` --tags "key=one_e2e_created,value=${Math.floor(Date.now() / 1000)}"` +
      ` --region "${region}"` +
      ` --output text`
  )
  expectCommandToSucceed(`Creating ECS service ${serviceName}`, result)
}

export const waitForServiceStable = async (serviceName: string): Promise<void> => {
  const result = await execPromiseWithRetries(
    `aws ecs wait services-stable --cluster "${requireEnv('AWS_ECS_CLUSTER')}" --services "${serviceName}" --region "${region}"`
  )
  expectCommandToSucceed(`Waiting for ECS service ${serviceName} to stabilize`, result)
}

/** The revision of the task definition the service is set to run. */
export const getServiceRevision = (serviceName: string): number => {
  const {services = []} = parseJson<{services?: {taskDefinition: string}[]}>(
    execSync(
      `aws ecs describe-services --cluster "${requireEnv('AWS_ECS_CLUSTER')}" --services "${serviceName}" --region "${region}" --output json`
    )
  )
  if (services.length === 0) {
    throw new Error(`ECS service ${serviceName} not found`)
  }

  return Number(services[0].taskDefinition.split(':').pop())
}

/**
 * The public address of the service's running task. Each deployment replaces the task, and with it
 * the elastic network interface, so this is resolved again after every rollout.
 */
const getTaskPublicIp = (serviceName: string): string => {
  const cluster = requireEnv('AWS_ECS_CLUSTER')
  const {taskArns = []} = parseJson<{taskArns?: string[]}>(
    execSync(
      `aws ecs list-tasks --cluster "${cluster}" --service-name "${serviceName}" --desired-status RUNNING --region "${region}" --output json`
    )
  )
  if (taskArns.length === 0) {
    throw new Error(`ECS service ${serviceName} is running no tasks`)
  }

  const {tasks = []} = parseJson<{tasks?: {attachments?: {details?: {name: string; value: string}[]}[]}[]}>(
    execSync(
      `aws ecs describe-tasks --cluster "${cluster}" --tasks "${taskArns[0]}" --region "${region}" --output json`
    )
  )
  const details = tasks[0]?.attachments?.[0]?.details ?? []
  const networkInterfaceId = details.find(({name}) => name === 'networkInterfaceId')?.value
  if (!networkInterfaceId) {
    throw new Error(`Task ${taskArns[0]} has no elastic network interface`)
  }

  const {NetworkInterfaces = []} = parseJson<{NetworkInterfaces?: {Association?: {PublicIp?: string}}[]}>(
    execSync(
      `aws ec2 describe-network-interfaces --network-interface-ids "${networkInterfaceId}" --region "${region}" --output json`
    )
  )
  const publicIp = NetworkInterfaces[0]?.Association?.PublicIp
  if (!publicIp) {
    throw new Error(`Network interface ${networkInterfaceId} has no public IP`)
  }

  return publicIp
}

export const getTaskUrl = (serviceName: string): string =>
  `http://${getTaskPublicIp(serviceName)}:${APP_CONTAINER_PORT}`

export const deleteService = async (serviceName: string): Promise<void> => {
  const cluster = requireEnv('AWS_ECS_CLUSTER')
  const scaleDown = await execPromise(
    `aws ecs update-service --cluster "${cluster}" --service "${serviceName}" --desired-count 0 --region "${region}" --output text`
  )
  if (scaleDown.exitCode !== 0 && !scaleDown.stderr.includes('ServiceNotFoundException')) {
    console.error(`Failed to scale down ECS service ${serviceName}: ${scaleDown.stderr}`)
  }

  const result = await execPromise(
    `aws ecs delete-service --cluster "${cluster}" --service "${serviceName}" --force --region "${region}" --output text`
  )
  if (result.exitCode !== 0 && !result.stderr.includes('ServiceNotFoundException')) {
    console.error(`Failed to delete ECS service ${serviceName}: ${result.stderr}`)
  }
}
