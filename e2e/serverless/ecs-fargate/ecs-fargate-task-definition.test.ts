import {execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {apiKey, commandEnv, instrumentCommand, uninstrumentCommand} from './ecs-fargate-command'
import {
  APP_CONTAINER_NAME,
  appImageFor,
  deregisterFamily,
  expectCommandToSucceed,
  familyFor,
  latestRevision,
  region,
  registerBaseTaskDefinition,
  runId,
} from './ecs-fargate-fixtures'
import {
  describeTaskDefinition,
  verifyApiKeyPlaintext,
  verifyInstrumented,
  verifyLogCollection,
  verifyUninstrumented,
} from './ecs-fargate-verifier'

const describeOrSkip =
  process.env.SKIP_ECS_FARGATE_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

// Fargate refuses to register a task definition that pulls an ECR image without an execution role,
// so the case that deliberately omits the role names a public image instead.
const PUBLIC_IMAGE = 'public.ecr.aws/docker/library/busybox:latest'

// These cases assert on the revisions the commands register, so no task ever runs. The image only
// has to exist for ECS to accept the task definition.
describeOrSkip('ecs-fargate task definitions', () => {
  const families: string[] = []

  const registerFixture = async (suffix: string, {withExecutionRole = true} = {}): Promise<string> => {
    const family = familyFor(`${suffix}-${runId()}`)
    families.push(family)
    await registerBaseTaskDefinition({
      family,
      image: withExecutionRole ? appImageFor('node-ssi') : PUBLIC_IMAGE,
      containerName: APP_CONTAINER_NAME,
      withExecutionRole,
    })

    return family
  }

  const expectation = (service: string) => ({
    service,
    env: 'e2e',
    version: 'task-definition',
    appContainerName: APP_CONTAINER_NAME,
  })

  const unifiedServiceTagFlags = (service: string): string =>
    `--service "${service}" --env e2e --version task-definition`

  afterAll(async () => {
    await Promise.all(families.map((family) => deregisterFamily(family)))
  }, 300_000)

  it('instruments and uninstruments a task definition', async () => {
    const family = await registerFixture('roundtrip')

    const instrument = await execPromiseWithRetries(
      instrumentCommand([family], unifiedServiceTagFlags(family)),
      commandEnv()
    )
    expectCommandToSucceed('Instrumenting task definition', instrument)
    expect(latestRevision(family)).toBe(2)
    verifyInstrumented(`${family}:2`, expectation(family))
    verifyApiKeyPlaintext(`${family}:2`, apiKey()!)

    const uninstrument = await execPromiseWithRetries(uninstrumentCommand([family]), commandEnv())
    expectCommandToSucceed('Uninstrumenting task definition', uninstrument)
    expect(latestRevision(family)).toBe(3)
    verifyUninstrumented(`${family}:3`)
  }, 300_000)

  it('registers no revision on a dry run', async () => {
    const family = await registerFixture('dry-run')

    const result = await execPromiseWithRetries(
      instrumentCommand([family], `${unifiedServiceTagFlags(family)} --dry-run`),
      commandEnv()
    )
    expectCommandToSucceed('Dry running instrument', result)
    expect(result.stdout).toContain('[Dry Run]')
    expect(result.stdout).toContain(family)
    expect(latestRevision(family)).toBe(1)
  }, 300_000)

  it('masks a plaintext API key in the diff it prints', async () => {
    const family = await registerFixture('masked-key')

    const result = await execPromiseWithRetries(
      instrumentCommand([family], `${unifiedServiceTagFlags(family)} --dry-run`),
      commandEnv()
    )
    expectCommandToSucceed('Dry running instrument', result)
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(apiKey())
  }, 300_000)

  it('adds the log router and routes every container through it', async () => {
    const family = await registerFixture('log-collection')

    const result = await execPromiseWithRetries(
      instrumentCommand([family], `${unifiedServiceTagFlags(family)} --log-collection`),
      commandEnv()
    )
    expectCommandToSucceed('Instrumenting with log collection', result)
    verifyInstrumented(`${family}:2`, expectation(family))
    verifyLogCollection(`${family}:2`)

    // Removing the router leaves the containers it collected with no log configuration, which is
    // the documented tradeoff: what it replaced is recorded nowhere.
    const uninstrument = await execPromiseWithRetries(uninstrumentCommand([family]), commandEnv())
    expectCommandToSucceed('Uninstrumenting after log collection', uninstrument)
    verifyUninstrumented(`${family}:3`)
  }, 300_000)

  it('instruments several task definitions in one run', async () => {
    const [first, second] = await Promise.all([registerFixture('multi-a'), registerFixture('multi-b')])

    const result = await execPromiseWithRetries(
      instrumentCommand([first, second], `--env e2e --version task-definition`),
      commandEnv()
    )
    expectCommandToSucceed('Instrumenting several task definitions', result)

    // With no --service, each task definition is tagged with its own family.
    verifyInstrumented(`${first}:2`, expectation(first))
    verifyInstrumented(`${second}:2`, expectation(second))
  }, 300_000)

  it('removes the environment variables named by --env-vars', async () => {
    const family = await registerFixture('env-vars')

    const instrument = await execPromiseWithRetries(
      instrumentCommand([family], `${unifiedServiceTagFlags(family)} --env-vars CUSTOM_VAR=kept`),
      commandEnv()
    )
    expectCommandToSucceed('Instrumenting with extra environment variables', instrument)
    const instrumented = describeTaskDefinition(`${family}:2`)
    for (const container of instrumented.containerDefinitions) {
      expect(container.environment).toContainEqual({name: 'CUSTOM_VAR', value: 'kept'})
    }

    const uninstrument = await execPromiseWithRetries(
      uninstrumentCommand([family], '--env-vars CUSTOM_VAR=kept'),
      commandEnv()
    )
    expectCommandToSucceed('Uninstrumenting with --env-vars', uninstrument)
    verifyUninstrumented(`${family}:3`)
    for (const container of describeTaskDefinition(`${family}:3`).containerDefinitions) {
      expect(container.environment ?? []).not.toContainEqual(expect.objectContaining({name: 'CUSTOM_VAR'}))
    }
  }, 300_000)

  it('registers no revision when there is nothing to uninstrument', async () => {
    const family = await registerFixture('already-clean')

    const result = await execPromiseWithRetries(uninstrumentCommand([family]), commandEnv())
    expectCommandToSucceed('Uninstrumenting a clean task definition', result)
    expect(result.stdout).toContain('no changes needed')
    expect(latestRevision(family)).toBe(1)
  }, 300_000)

  // The failures below are expected, so they run without retries.
  it('reports a task definition that does not exist', async () => {
    const family = familyFor(`missing-${runId()}`)

    const result = await execPromise(instrumentCommand([family], `--service "${family}"`), commandEnv())
    expect(result.exitCode).toBe(1)
  }, 300_000)

  it('refuses two revisions of the same family in one run', async () => {
    const family = await registerFixture('duplicate')

    const result = await execPromise(
      instrumentCommand([family, `${family}:1`], unifiedServiceTagFlags(family)),
      commandEnv()
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('names the same task definition family more than once')
    // Nothing is registered: the run is rejected before it reaches AWS.
    expect(latestRevision(family)).toBe(1)
  }, 300_000)

  it('refuses a secret reference the task definition could not resolve', async () => {
    const family = await registerFixture('no-execution-role', {withExecutionRole: false})

    const result = await execPromise(
      instrumentCommand(
        [family],
        `${unifiedServiceTagFlags(family)} --api-key-secret-arn "arn:aws:secretsmanager:${region}:000000000000:secret:not-used"`
      ),
      commandEnv()
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('executionRoleArn')
    expect(latestRevision(family)).toBe(1)
  }, 300_000)
})
