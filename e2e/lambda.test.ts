import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {ExecResult} from './helpers/exec'

import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from './helpers/exec'
import {verifyLambdaInstrumented, verifyLambdaUninstrumented} from './helpers/lambda-verifier'

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
  const functionName = `dd-ci-lambda-${crypto.randomBytes(4).toString('hex')}`
  const functionZipPath = path.join(os.tmpdir(), `${functionName}.zip`)
  const handlerPath = path.join(process.cwd(), 'e2e', 'fixtures', 'lambda', 'index.js')
  const expectedTags = {
    environment: 'e2e',
    service: 'datadog-ci-lambda-e2e',
    version: (process.env.GITHUB_SHA ?? 'local').slice(0, 40),
  }
  let functionCreated = false

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

    const zipResult = await execPromise(`zip -j -q "${functionZipPath}" "${handlerPath}"`)
    expectCommandToSucceed('Creating Lambda fixture zip', zipResult)

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

    try {
      if (fs.existsSync(functionZipPath)) {
        fs.unlinkSync(functionZipPath)
      }
    } catch (error) {
      console.error('Failed to delete Lambda fixture zip:', error)
    }
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} lambda instrument` +
        ` -f "${functionName}"` +
        ` -r "${region}"` +
        ` --service "${expectedTags.service}"` +
        ` --env "${expectedTags.environment}"` +
        ` --version "${expectedTags.version}"` +
        ` --no-source-code-integration`,
      {
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_SITE: process.env.DATADOG_SITE,
        DD_API_KEY: process.env.DD_API_KEY,
      }
    )
    expectCommandToSucceed('Instrumenting Lambda function', result)

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
