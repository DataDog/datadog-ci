import {execPromiseWithRetries} from '../../helpers/exec'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'
import {triggerTraffic} from '../helpers/traffic'

import {commandEnv, instrumentCommand, uninstrumentCommand} from './ecs-fargate-command'
import {
  APP_CONTAINER_NAME,
  appImageFor,
  createFargateService,
  deleteService,
  deregisterFamily,
  expectCommandToSucceed,
  familyFor,
  getServiceRevision,
  getTaskUrl,
  latestRevision,
  registerBaseTaskDefinition,
  requireEnv,
  runId,
  waitForServiceStable,
} from './ecs-fargate-fixtures'
import {
  getTaskDefinitionSnapshot,
  verifyApiKeyFromSecret,
  verifyInstrumented,
  verifyLogCollection,
  verifySsiInstrumented,
  verifyUninstrumented,
} from './ecs-fargate-verifier'

const describeOrSkip =
  process.env.SKIP_ECS_FARGATE_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

// One service covers the paths that only a running task can prove: the Agent reads its key from
// Secrets Manager, the injected tracer loads, and the traces and logs both reach Datadog.
describeOrSkip('ecs-fargate', () => {
  const id = runId()
  const family = familyFor(`svc-${id}`)
  const serviceName = `${family}-service`
  const expectedTags = {
    service: family,
    env: 'e2e',
    version: (process.env.GITHUB_SHA ?? 'local').slice(0, 40),
  }

  let secretArn: string
  let cluster: string
  let serviceCreated = false

  const command = () =>
    instrumentCommand(
      [family],
      `--ecs-service "${serviceName}"` +
        ` --cluster "${cluster}"` +
        ` --api-key-secret-arn "${secretArn}"` +
        ` --log-collection` +
        ` --tracing inject --language nodejs` +
        ` --service "${expectedTags.service}"` +
        ` --env "${expectedTags.env}"` +
        ` --version "${expectedTags.version}"` +
        ` --extra-tags "one_e2e_run_id:${id}"`
    )

  beforeAll(async () => {
    secretArn = requireEnv('AWS_ECS_API_KEY_SECRET_ARN')
    cluster = requireEnv('AWS_ECS_CLUSTER')

    const registered = await registerBaseTaskDefinition({
      family,
      image: appImageFor('node-ssi'),
      containerName: APP_CONTAINER_NAME,
    })
    await createFargateService(serviceName, registered.taskDefinitionArn)
    serviceCreated = true
    await waitForServiceStable(serviceName)
  }, 900_000)

  afterAll(async () => {
    if (serviceCreated) {
      await deleteService(serviceName)
    }
    await deregisterFamily(family)
  }, 900_000)

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(command(), commandEnv())
    expectCommandToSucceed('Instrumenting the task definition', result)

    expect(latestRevision(family)).toBe(2)
    verifyInstrumented(`${family}:2`, {...expectedTags, appContainerName: APP_CONTAINER_NAME})
    verifyApiKeyFromSecret(`${family}:2`, secretArn)
    verifyLogCollection(`${family}:2`, {secretArn})
    verifySsiInstrumented(`${family}:2`, {
      appContainerName: APP_CONTAINER_NAME,
      tracerRepository: 'js',
      nativeEnv: {name: 'NODE_OPTIONS', value: '--require /datadog-lib/node_modules/dd-trace/init.js'},
    })

    // The command returns as soon as ECS accepts the deployment, so the service points at the new
    // revision before its tasks are running it.
    expect(getServiceRevision(serviceName)).toBe(2)
  }, 900_000)

  it('invoke and verify telemetry', async () => {
    await waitForServiceStable(serviceName)

    // The deployment replaced the task, so its address is resolved again.
    await triggerTraffic(getTaskUrl(serviceName), {attempts: 20, requiredSuccesses: 5, intervalSeconds: 10})

    await checkTelemetryFlowing({
      serviceName: expectedTags.service,
      env: expectedTags.env,
      version: expectedTags.version,
      tags: [`one_e2e_run_id:${id}`],
    })
  }, 900_000)

  it('idempotent reinstrument', async () => {
    const before = getTaskDefinitionSnapshot(`${family}:2`)

    const result = await execPromiseWithRetries(command(), commandEnv())
    expectCommandToSucceed('Re-instrumenting the task definition', result)
    expect(result.stdout).toContain('no changes needed')

    // Re-instrumenting with the same arguments registers nothing and leaves the service alone.
    expect(latestRevision(family)).toBe(2)
    expect(getTaskDefinitionSnapshot(`${family}:2`)).toEqual(before)
    expect(getServiceRevision(serviceName)).toBe(2)
  }, 900_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      uninstrumentCommand([family], `--ecs-service "${serviceName}" --cluster "${cluster}"`),
      commandEnv()
    )
    expectCommandToSucceed('Uninstrumenting the task definition', result)

    expect(latestRevision(family)).toBe(3)
    verifyUninstrumented(`${family}:3`)
    expect(getServiceRevision(serviceName)).toBe(3)

    await waitForServiceStable(serviceName)
  }, 900_000)
})
