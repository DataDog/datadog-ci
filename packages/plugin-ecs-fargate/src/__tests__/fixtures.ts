import type {InstrumentSettings} from '../task-definition'
import type {
  ContainerDefinition,
  MountPoint,
  RegisterTaskDefinitionCommandInput,
  Service,
  Tag,
  TaskDefinition,
  Volume,
} from '@aws-sdk/client-ecs'

export const MOCK_API_KEY = '02aeb762fff59ac0d5ad1536cd9633bd'
export const MOCK_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dd-api-key-AbCdEf'
export const MOCK_REGION = 'us-east-1'
export const MOCK_FAMILY = 'my-app'
export const MOCK_CLUSTER = 'my-cluster'
export const MOCK_SERVICE = 'my-app-service'

export const taskDefinitionArn = (family = MOCK_FAMILY, revision = 1): string =>
  `arn:aws:ecs:${MOCK_REGION}:123456789012:task-definition/${family}:${revision}`

/** A service ARN in the long format, which names the cluster the service runs in. */
export const serviceArn = (service = MOCK_SERVICE, cluster = MOCK_CLUSTER): string =>
  `arn:aws:ecs:${MOCK_REGION}:123456789012:service/${cluster}/${service}`

export const CLI_VERSION_TAG: Tag = {key: 'dd_sls_ci', value: 'vXXXX'}
/** The tags every instrumented revision carries. */
export const INSTRUMENTATION_TAGS: Tag[] = [CLI_VERSION_TAG]

/** No `agentImage`, so the transform picks the default build. */
export const MOCK_SETTINGS: InstrumentSettings = {
  site: 'datadoghq.com',
  apiKeySecretArn: MOCK_API_KEY_SECRET_ARN,
}

/** What carries the Agent's APM and DogStatsD sockets between the containers sharing them. */
export const SOCKET_VOLUME: Volume = {name: 'dd-sockets'}
export const SOCKET_MOUNT: MountPoint = {
  sourceVolume: 'dd-sockets',
  containerPath: '/var/run/datadog',
  readOnly: false,
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
export const fargateTaskDefinition = ({
  family = MOCK_FAMILY,
  revision = 1,
  ...overrides
}: Partial<TaskDefinition> = {}): TaskDefinition => ({
  taskDefinitionArn: taskDefinitionArn(family, revision),
  family,
  revision,
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
  taskRoleArn: 'arn:aws:iam::123456789012:role/my-app-task-role',
  containerDefinitions: [{...APP_CONTAINER}],
  volumes: [],
  ...overrides,
})

/**
 * A revision the command registered, as `DescribeTaskDefinition` hands it back to the next run:
 * read-only fields and all.
 */
export const asDescribed = (
  registered: RegisterTaskDefinitionCommandInput,
  overrides: Partial<TaskDefinition> = {}
): TaskDefinition =>
  fargateTaskDefinition({
    containerDefinitions: registered.containerDefinitions,
    volumes: registered.volumes,
    ...overrides,
  })

/**
 * An ECS service as `DescribeServices` returns it, running the first revision of its family.
 */
export const fargateService = ({
  serviceName = MOCK_SERVICE,
  taskDefinition = taskDefinitionArn(),
  ...overrides
}: Partial<Service> = {}): Service => ({
  serviceName,
  serviceArn: serviceArn(serviceName),
  clusterArn: `arn:aws:ecs:${MOCK_REGION}:123456789012:cluster/${MOCK_CLUSTER}`,
  taskDefinition,
  status: 'ACTIVE',
  launchType: 'FARGATE',
  desiredCount: 2,
  ...overrides,
})
