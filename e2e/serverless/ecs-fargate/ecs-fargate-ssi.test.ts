import {execPromiseWithRetries} from '../../helpers/exec'

import {SSI_CASES as ssiCases} from '../helpers/ssi'

import {commandEnv, instrumentCommand, uninstrumentCommand} from './ecs-fargate-command'
import {
  APP_CONTAINER_NAME,
  appImageFor,
  deregisterFamily,
  expectCommandToSucceed,
  familyFor,
  registerBaseTaskDefinition,
  requireEnv,
  runId,
} from './ecs-fargate-fixtures'
import {verifySsiInstrumented, verifyTracerEnvRemoved, verifyUninstrumented} from './ecs-fargate-verifier'

const describeOrSkip =
  process.env.SKIP_ECS_FARGATE_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true'
    ? describe.skip
    : describe

const SSI_CASES = [
  ...ssiCases.map(({fixtureImageName, ...ssiCase}) => ({
    ...ssiCase,
    testName: ssiCase.language,
    fixtureImageName,
    languageFlag: ` --language "${ssiCase.language}"`,
  })),
  {
    // Omitting --language copies the composite image, which carries every tracer and picks one at
    // startup, instead of the single-language image.
    testName: 'composite',
    language: 'composite',
    fixtureImageName: 'node-ssi',
    tracerRepository: undefined,
    nativeEnv: {name: 'LD_PRELOAD', value: '/opt/datadog-packages/datadog-apm-inject'},
    languageFlag: '',
  },
] as const

// The tracer is copied by a container the task runs, so injection is verified on the revision the
// command registers. One language is deployed and traced in ecs-fargate.test.ts.
describeOrSkip('ecs-fargate automatic APM instrumentation', () => {
  it.concurrent.each(SSI_CASES)(
    'injects and removes the $testName tracer',
    async ({testName, fixtureImageName, tracerRepository, nativeEnv, languageFlag}) => {
      // Read here rather than in the describe body, which runs even when the suite is skipped.
      const secretArn = requireEnv('AWS_ECS_API_KEY_SECRET_ARN')
      const family = familyFor(`ssi-${testName}-${runId()}`)
      const flags = `--service "${family}" --env e2e --tracing inject${languageFlag} --api-key-secret-arn "${secretArn}"`

      try {
        await registerBaseTaskDefinition({
          family,
          image: appImageFor(fixtureImageName),
          containerName: APP_CONTAINER_NAME,
        })

        const instrument = await execPromiseWithRetries(instrumentCommand([family], flags), commandEnv())
        expectCommandToSucceed(`Injecting the ${testName} tracer`, instrument)
        verifySsiInstrumented(`${family}:2`, {
          appContainerName: APP_CONTAINER_NAME,
          tracerRepository,
          nativeEnv: tracerRepository === undefined ? undefined : nativeEnv,
        })

        // Re-running with the same arguments must not register another revision.
        const retry = await execPromiseWithRetries(instrumentCommand([family], flags), commandEnv())
        expectCommandToSucceed(`Re-injecting the ${testName} tracer`, retry)
        expect(retry.stdout).toContain('no changes needed')

        const uninstrument = await execPromiseWithRetries(uninstrumentCommand([family]), commandEnv())
        expectCommandToSucceed(`Removing the ${testName} tracer`, uninstrument)
        verifyUninstrumented(`${family}:3`)
        verifyTracerEnvRemoved(`${family}:3`, nativeEnv)
      } finally {
        await deregisterFamily(family)
      }
    },
    600_000
  )
})
