import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {ExecResult} from './helpers/exec'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'
import {checkTelemetryFlowing, verifyLambdaInstrumented, verifyLambdaUninstrumented} from './helpers/lambda-verifier'

const describeOrSkip =
  process.env.SKIP_LAMBDA_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

const expectCommandToSucceed = (description: string, result: ExecResult): void => {
  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed (exit code ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    )
  }
}

describeOrSkip('lambda', () => {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1'
  const executionRoleArn = process.env.AWS_LAMBDA_EXECUTION_ROLE_ARN
  const functionName = `dd-e2e-ci-lambda-${crypto.randomBytes(4).toString('hex')}`
  const functionZipPath = path.join(os.tmpdir(), `${functionName}.zip`)
  const handlerPath = path.join(os.tmpdir(), `${functionName}-index.js`)
  const handlerSource = `exports.handler = async () => {
  console.log(JSON.stringify({message: 'Lambda e2e test invoked'}))
  return {statusCode: 200, body: JSON.stringify({ok: true})}
}`
  const expectedTags = {
    environment: 'e2e',
    service: 'datadog-ci-lambda-e2e',
    version: (process.env.GITHUB_SHA ?? 'local').slice(0, 40),
  }
  let functionCreated = false

  const instrumentCommand =
    `${DATADOG_CI_COMMAND} lambda instrument` +
    ` -f "${functionName}"` +
    ` -r "${region}"` +
    ` --service "${expectedTags.service}"` +
    ` --env "${expectedTags.environment}"` +
    ` --version "${expectedTags.version}"` +
    ` --no-source-code-integration`

  const instrumentEnv = {
    DATADOG_API_KEY: process.env.DATADOG_API_KEY,
    DATADOG_SITE: process.env.DATADOG_SITE,
    DD_API_KEY: process.env.DD_API_KEY,
  }

  const waitForFunctionActive = async (): Promise<void> => {
    const result = await execPromiseWithRetries(
      `aws lambda wait function-active-v2 --function-name "${functionName}" --region "${region}"`
    )
    expectCommandToSucceed('Waiting for Lambda function to become active', result)
  }

  const waitForFunctionUpdated = async (): Promise<void> => {
    const result = await execPromiseWithRetries(
      `aws lambda wait function-updated-v2 --function-name "${functionName}" --region "${region}"`
    )
    expectCommandToSucceed('Waiting for Lambda function update', result)
  }

  beforeAll(async () => {
    if (!executionRoleArn) {
      throw new Error('AWS_LAMBDA_EXECUTION_ROLE_ARN must be set to run Lambda e2e tests')
    }

    fs.writeFileSync(handlerPath, handlerSource)
    const zipResult = await execPromise(`zip -j -q "${functionZipPath}" "${handlerPath}"`)
    expectCommandToSucceed('Creating Lambda fixture zip', zipResult)

    const createdAt = Math.floor(Date.now() / 1000).toString()
    const createResult = await execPromiseWithRetries(
      `aws lambda create-function` +
        ` --function-name "${functionName}"` +
        ` --runtime nodejs24.x` +
        ` --role "${executionRoleArn}"` +
        ` --handler index.handler` +
        ` --zip-file "fileb://${functionZipPath}"` +
        ` --timeout 30` +
        ` --memory-size 128` +
        ` --architectures x86_64` +
        ` --tags "dd_e2e_created=${createdAt}"` +
        ` --region "${region}"` +
        ` --output text`
    )
    expectCommandToSucceed('Creating Lambda function', createResult)
    functionCreated = true

    await waitForFunctionActive()
  }, 600_000)

  afterAll(async () => {
    if (functionCreated) {
      await execPromise(`aws lambda wait function-updated-v2 --function-name "${functionName}" --region "${region}"`)
      const deleteResult = await execPromise(
        `aws lambda delete-function --function-name "${functionName}" --region "${region}" --output text`
      )
      if (deleteResult.exitCode !== 0 && !deleteResult.stderr.includes('ResourceNotFoundException')) {
        console.error(
          `Failed to delete ephemeral Lambda function (exit code ${deleteResult.exitCode}): ${deleteResult.stderr}`
        )
      }
    }

    for (const tempFile of [functionZipPath, handlerPath]) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch (error) {
        console.error(`Failed to delete temp file ${tempFile}:`, error)
      }
    }
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, instrumentEnv)
    expectCommandToSucceed('Instrumenting Lambda function', result)

    await waitForFunctionUpdated()
    verifyLambdaInstrumented(functionName, region, expectedTags)
  }, 600_000)

  it('invoke and verify telemetry', async () => {
    const invokeOutputPath = path.join(os.tmpdir(), `${functionName}-invoke.json`)
    const invokeResult = await execPromise(
      `aws lambda invoke --function-name "${functionName}" --region "${region}" "${invokeOutputPath}"`
    )
    expectCommandToSucceed('Invoking Lambda function', invokeResult)

    await checkTelemetryFlowing(expectedTags.service)
  }, 600_000)

  it('idempotent reinstrument', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, instrumentEnv)
    expectCommandToSucceed('Re-instrumenting Lambda function', result)

    await waitForFunctionUpdated()
    verifyLambdaInstrumented(functionName, region, expectedTags)
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} lambda uninstrument -f "${functionName}" -r "${region}"`
    )
    expectCommandToSucceed('Uninstrumenting Lambda function', result)

    await waitForFunctionUpdated()
    verifyLambdaUninstrumented(functionName, region)
  }, 600_000)
})
