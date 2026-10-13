import type {RegisterTaskDefinitionCommandInput, Tag, TaskDefinition} from '@aws-sdk/client-ecs'
import type {FromIniInit} from '@aws-sdk/credential-provider-ini'
import type {AwsCredentialIdentity, AwsCredentialIdentityProvider} from '@aws-sdk/types'

import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  RegisterTaskDefinitionCommand,
  TaskDefinitionField,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs'
import {fromIni, fromNodeProviderChain} from '@aws-sdk/credential-providers'
import {input as promptInput} from '@inquirer/prompts'
import {CredentialsProviderError} from '@smithy/property-provider'

import {AWS_SHARED_CREDENTIALS_FILE_ENV_VAR, EXPONENTIAL_BACKOFF_RETRY_STRATEGY} from './constants'

// TODO: the two credential helpers below are duplicated from plugin-lambda's `functions/commons.ts`.
// Move them to a shared `helpers/serverless/aws.ts` in the base package, alongside
// `AWS_SHARED_CREDENTIALS_FILE_ENV_VAR` and the retry strategy from `constants.ts`.

const mfaCodeQuestion = (mfaSerial: string) => ({
  message: `Enter MFA code for ${mfaSerial}: `,
  validate: (value: string) =>
    value.length >= 6 || 'Enter a valid MFA token. Length must be greater than or equal to 6.',
})

/**
 * Returns the credentials loaded from the given AWS named profile.
 */
export const getAWSProfileCredentials = async (profile: string): Promise<AwsCredentialIdentity | undefined> => {
  const init: FromIniInit = {profile}
  if (process.env[AWS_SHARED_CREDENTIALS_FILE_ENV_VAR] !== undefined) {
    init.filepath = process.env[AWS_SHARED_CREDENTIALS_FILE_ENV_VAR]
  }

  // A profile with an `mfa_serial` cannot be resolved without a code, so one is asked for rather
  // than letting the profile fail to load.
  init.mfaCodeProvider = (mfaSerial) => promptInput(mfaCodeQuestion(mfaSerial))

  try {
    const credentialsProvider: AwsCredentialIdentityProvider = fromIni(init)

    return await credentialsProvider()
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't get AWS profile credentials. ${err.message}`)
    }
  }
}

/**
 * Returns credentials from the default AWS provider chain, or `undefined` when none are configured.
 * The SDK also resolves these itself, so an absent result is not fatal.
 */
export const getAWSCredentials = async (): Promise<AwsCredentialIdentity | undefined> => {
  const provider = fromNodeProviderChain()

  try {
    return await provider()
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === CredentialsProviderError.name) {
        return undefined
      }
      throw Error(`Couldn't fetch AWS credentials. ${err.message}`)
    }
  }
}

export const createECSClient = (region: string, credentials?: AwsCredentialIdentity): ECSClient =>
  new ECSClient({region, credentials, retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY})

/**
 * A described task definition along with its tags, which ECS returns alongside the definition
 * rather than inside it, and only when they are explicitly requested.
 */
export type DescribedTaskDefinition = {
  taskDefinition: TaskDefinition
  tags: Tag[]
}

export const describeTaskDefinition = async (
  client: ECSClient,
  taskDefinition: string
): Promise<DescribedTaskDefinition> => {
  const response = await client.send(
    new DescribeTaskDefinitionCommand({taskDefinition, include: [TaskDefinitionField.TAGS]})
  )
  if (!response.taskDefinition) {
    throw Error(`No task definition found for ${taskDefinition}.`)
  }

  return {taskDefinition: response.taskDefinition, tags: response.tags ?? []}
}

/**
 * A revision this command registered. The revision number is what the user needs to deploy and the
 * ARN is what a service has to be pointed at, so both are checked here rather than at each use.
 */
export type RegisteredTaskDefinition = TaskDefinition & {taskDefinitionArn: string; revision: number}

export const registerTaskDefinition = async (
  client: ECSClient,
  input: RegisterTaskDefinitionCommandInput
): Promise<RegisteredTaskDefinition> => {
  const response = await client.send(new RegisterTaskDefinitionCommand(input))
  const registered = response.taskDefinition
  if (registered?.revision === undefined || registered.taskDefinitionArn === undefined) {
    throw Error('RegisterTaskDefinition did not return the new revision.')
  }

  return {...registered, taskDefinitionArn: registered.taskDefinitionArn, revision: registered.revision}
}

/**
 * The `family:revision` a task definition ARN ends in, which is how ECS names a revision.
 */
export const taskDefinitionRevision = (taskDefinitionArn: string): string =>
  taskDefinitionArn.split('/').pop() ?? taskDefinitionArn

/**
 * The family a task definition belongs to, either named by family, `family:revision`,
 * or a full ARN. ties an ECS service to the task definition this command instruments.
 */
export const taskDefinitionFamily = (taskDefinition: string): string =>
  taskDefinitionRevision(taskDefinition).split(':')[0]

/**
 * An ECS service, narrowed to what pointing it at a new task definition revision needs.
 */
export type DescribedService = {
  name: string
  /** The ARN of the task definition revision the service runs today. */
  taskDefinition: string
}

/**
 * DescribeServices accepts at most 10 names per call.
 * https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeServices.html
 */
export const DESCRIBE_SERVICES_MAX = 10

const lastSegment = (value: string): string => value.split('/').pop() ?? value

/**
 * Whether a DescribeServices result names the service the run asked for: the API returns a short
 * name, a full ARN, or either as the last path segment.
 */
const refersTo = (requested: string, candidate?: string): boolean =>
  candidate !== undefined && (candidate === requested || lastSegment(candidate) === lastSegment(requested))

/**
 * Describes the named ECS services, in batches of {@link DESCRIBE_SERVICES_MAX}.
 *
 * A service the API cannot find is reported without blocking the rest of its batch, and a batch
 * that fails to send is reported without blocking the other batches.
 */
export const describeServices = async (
  client: ECSClient,
  cluster: string | undefined,
  services: string[]
): Promise<[DescribedService[], string[]]> => {
  if (services.length === 0) {
    return [[], []]
  }

  const batches = Array.from({length: Math.ceil(services.length / DESCRIBE_SERVICES_MAX)}, (_, i) =>
    services.slice(i * DESCRIBE_SERVICES_MAX, (i + 1) * DESCRIBE_SERVICES_MAX)
  )
  const results = await Promise.allSettled(batches.map((batch) => describeServicesBatch(client, cluster, batch)))

  const described: DescribedService[] = []
  const errors: string[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason
      errors.push(reason instanceof Error ? reason.message : String(reason))
      continue
    }

    described.push(...result.value.described)
    errors.push(...result.value.errors)
  }

  return [described, errors]
}

const describeServicesBatch = async (
  client: ECSClient,
  cluster: string | undefined,
  services: string[]
): Promise<{described: DescribedService[]; errors: string[]}> => {
  const response = await client.send(new DescribeServicesCommand({cluster, services}))
  const remaining = [...(response.services ?? [])]
  const failures = [...(response.failures ?? [])]
  const described: DescribedService[] = []
  const errors: string[] = []

  for (const service of services) {
    const index = remaining.findIndex(
      (candidate) => refersTo(service, candidate.serviceName) || refersTo(service, candidate.serviceArn)
    )
    if (index >= 0) {
      const [match] = remaining.splice(index, 1)
      if (match?.taskDefinition) {
        described.push({name: match.serviceName ?? service, taskDefinition: match.taskDefinition})
        continue
      }
    }

    const failureIndex = failures.findIndex((failure) => refersTo(service, failure.arn))
    const reason = failureIndex >= 0 ? failures.splice(failureIndex, 1)[0]?.reason : undefined
    errors.push(
      `No ECS service found for ${service}${reason ? ` (${reason})` : ''} in the ${cluster ?? 'default'} cluster.`
    )
  }

  return {described, errors}
}

/**
 * Points a service at a task definition revision, which starts an ECS deployment.
 */
export const updateServiceTaskDefinition = async (
  client: ECSClient,
  cluster: string | undefined,
  service: string,
  taskDefinition: string
): Promise<void> => {
  await client.send(new UpdateServiceCommand({cluster, service, taskDefinition}))
}
