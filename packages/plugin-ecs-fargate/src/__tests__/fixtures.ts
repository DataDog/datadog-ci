import type {InstrumentSettings} from '../task-definition'
import type {ContainerDefinition, Tag, TaskDefinition} from '@aws-sdk/client-ecs'

import {AGENT_IMAGE} from '@datadog/datadog-ci-base/helpers/serverless/constants'

export const MOCK_API_KEY = '02aeb762fff59ac0d5ad1536cd9633bd'
export const MOCK_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dd-api-key-AbCdEf'
export const MOCK_REGION = 'us-east-1'
export const MOCK_FAMILY = 'my-app'

export const CLI_VERSION_TAG: Tag = {key: 'dd_sls_ci', value: 'vXXXX'}
/** The service tag a run that was not given a `--service` writes, from the task definition family. */
export const SERVICE_TAG: Tag = {key: 'service', value: MOCK_FAMILY}
/** The tags every instrumented revision carries. */
export const INSTRUMENTATION_TAGS: Tag[] = [SERVICE_TAG, CLI_VERSION_TAG]

export const MOCK_SETTINGS: InstrumentSettings = {
  agentImage: AGENT_IMAGE,
  site: 'datadoghq.com',
  apiKeySecretArn: MOCK_API_KEY_SECRET_ARN,
}

export const APP_CONTAINER: ContainerDefinition = {
  name: 'my-app',
  image: 'my-app:latest',
  essential: true,
  environment: [{name: 'PORT', value: '8080'}],
  logConfiguration: {
    logDriver: 'awslogs',
    options: {
      'awslogs-group': '/ecs/my-app',
      'awslogs-region': MOCK_REGION,
      'awslogs-stream-prefix': 'ecs',
    },
  },
}

/**
 * A task definition as `DescribeTaskDefinition` returns it, read-only fields included.
 */
export const fargateTaskDefinition = (overrides: Partial<TaskDefinition> = {}): TaskDefinition => ({
  taskDefinitionArn: `arn:aws:ecs:${MOCK_REGION}:123456789012:task-definition/${MOCK_FAMILY}:1`,
  family: MOCK_FAMILY,
  revision: 1,
  status: 'ACTIVE',
  requiresAttributes: [{name: 'com.amazonaws.ecs.capability.docker-remote-api.1.29'}],
  compatibilities: ['EC2', 'FARGATE'],
  registeredAt: new Date('2024-01-01T00:00:00Z'),
  registeredBy: 'arn:aws:iam::123456789012:user/someone',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '512',
  memory: '1024',
  executionRoleArn: 'arn:aws:iam::123456789012:role/ecsTaskExecutionRole',
  containerDefinitions: [{...APP_CONTAINER}],
  volumes: [],
  ...overrides,
})
