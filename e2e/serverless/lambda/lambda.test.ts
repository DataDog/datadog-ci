import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {ExecResult} from '../../helpers/exec'
import {DATADOG_CI_COMMAND, execPromise, execPromiseWithRetries} from '../../helpers/exec'

import {
  getLambdaSnapshot,
  verifyLambdaExtensionOnly,
  verifyLambdaInstrumented,
  verifyLambdaUninstrumented,
} from './lambda-verifier'

import {checkTelemetryFlowing} from '../helpers/telemetry-checker'

const describeOrSkip =
  process.env.SKIP_LAMBDA_TESTS === 'true' || process.env.IS_STANDALONE_BINARY === 'true' ? describe.skip : describe

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1'
const executionRoleArn = process.env.AWS_LAMBDA_EXECUTION_ROLE_ARN

// Pin explicit layer versions so the tests assert the CLI honors the requested
// versions, rather than whatever 'latest' happens to resolve to on a given day.
// These are decoupled from the CLI's own constants by design -- the e2e job only
// checks out e2e/, so it cannot import from packages/.
const NODE_LAYER_VERSION = 139
const EXTENSION_LAYER_VERSION = 97

const expectCommandToSucceed = (description: string, result: ExecResult): void => {
  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed (exit code ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    )
  }
}

const waitForFunctionActive = async (functionName: string): Promise<void> => {
  const result = await execPromiseWithRetries(
    `aws lambda wait function-active-v2 --function-name "${functionName}" --region "${region}"`
  )
  expectCommandToSucceed('Waiting for Lambda function to become active', result)
}

const waitForFunctionUpdated = async (functionName: string): Promise<void> => {
  const result = await execPromiseWithRetries(
    `aws lambda wait function-updated-v2 --function-name "${functionName}" --region "${region}"`
  )
  expectCommandToSucceed('Waiting for Lambda function update', result)
}

const deleteFunction = async (functionName: string): Promise<void> => {
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

const removeTempFiles = (tempFiles: string[]): void => {
  for (const tempFile of tempFiles) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    } catch (error) {
      console.error(`Failed to delete temp file ${tempFile}:`, error)
    }
  }
}

const instrumentEnv = {
  DATADOG_API_KEY: process.env.DATADOG_API_KEY,
  DATADOG_SITE: process.env.DATADOG_SITE,
  DD_API_KEY: process.env.DD_API_KEY,
}

describeOrSkip('lambda', () => {
  const runId = crypto.randomBytes(4).toString('hex')
  const functionName = `one-e2e-ci-lambda-${runId}`
  const functionZipPath = path.join(os.tmpdir(), `${functionName}.zip`)
  const handlerPath = path.join(os.tmpdir(), `${functionName}-index.js`)
  const handlerSource = `exports.handler = async () => {
  console.log(JSON.stringify({message: 'Lambda e2e test invoked'}))
  return {statusCode: 200, body: JSON.stringify({ok: true})}
}`
  // Use the unique per-run function name as the service so telemetry is filtered
  // by run id -- this asserts THIS run's traces/logs flowed, not mere existence.
  const expectedTags = {
    environment: 'e2e',
    service: functionName,
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
    ` --layer-version ${NODE_LAYER_VERSION}` +
    ` --extension-version ${EXTENSION_LAYER_VERSION}` +
    ` --no-source-code-integration`

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
        ` --tags "one_e2e_created=${createdAt}"` +
        ` --region "${region}"` +
        ` --output text`
    )
    expectCommandToSucceed('Creating Lambda function', createResult)
    functionCreated = true

    await waitForFunctionActive(functionName)
  }, 600_000)

  afterAll(async () => {
    if (functionCreated) {
      await deleteFunction(functionName)
    }
    removeTempFiles([functionZipPath, handlerPath])
  })

  it('instrument and verify', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, instrumentEnv)
    expectCommandToSucceed('Instrumenting Lambda function', result)

    await waitForFunctionUpdated(functionName)
    verifyLambdaInstrumented(functionName, region, expectedTags, {
      node: NODE_LAYER_VERSION,
      extension: EXTENSION_LAYER_VERSION,
    })
  }, 600_000)

  it('invoke and verify telemetry', async () => {
    const invokeOutputPath = path.join(os.tmpdir(), `${functionName}-invoke.json`)
    const invokeResult = await execPromise(
      `aws lambda invoke --function-name "${functionName}" --region "${region}" "${invokeOutputPath}"`
    )
    expectCommandToSucceed('Invoking Lambda function', invokeResult)

    await checkTelemetryFlowing({
      serviceName: expectedTags.service,
      env: expectedTags.environment,
      version: expectedTags.version,
    })
  }, 600_000)

  it('idempotent reinstrument', async () => {
    const before = getLambdaSnapshot(functionName, region)

    const result = await execPromiseWithRetries(instrumentCommand, instrumentEnv)
    expectCommandToSucceed('Re-instrumenting Lambda function', result)

    await waitForFunctionUpdated(functionName)

    // Re-instrumenting with the same arguments must leave the function unchanged.
    const after = getLambdaSnapshot(functionName, region)
    expect(after).toEqual(before)
    verifyLambdaInstrumented(functionName, region, expectedTags, {
      node: NODE_LAYER_VERSION,
      extension: EXTENSION_LAYER_VERSION,
    })
  }, 600_000)

  it('uninstrument and verify', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} lambda uninstrument -f "${functionName}" -r "${region}"`
    )
    expectCommandToSucceed('Uninstrumenting Lambda function', result)

    await waitForFunctionUpdated(functionName)
    verifyLambdaUninstrumented(functionName, region)
  }, 600_000)
})

// The custom (provided.al2023) runtime has no Datadog language layer, so instrumenting
// it exercises the extension-only path: only the extension layer is added, with no
// handler rewrite.
describeOrSkip('lambda extension-only (custom runtime)', () => {
  const runId = crypto.randomBytes(4).toString('hex')
  const functionName = `one-e2e-ci-lambda-custom-${runId}`
  const functionZipPath = path.join(os.tmpdir(), `${functionName}.zip`)
  const bootstrapPath = path.join(os.tmpdir(), `${functionName}-bootstrap`)
  // A minimal bootstrap satisfies create-function; these tests verify configuration
  // only and never invoke the function.
  const bootstrapSource = '#!/bin/sh\nexit 0\n'
  const originalHandler = 'bootstrap'
  const expectedTags = {
    environment: 'e2e',
    service: functionName,
    version: (process.env.GITHUB_SHA ?? 'local').slice(0, 40),
  }
  let functionCreated = false

  // Custom runtimes reject --layer-version, so only the extension version is pinned.
  const instrumentCommand =
    `${DATADOG_CI_COMMAND} lambda instrument` +
    ` -f "${functionName}"` +
    ` -r "${region}"` +
    ` --service "${expectedTags.service}"` +
    ` --env "${expectedTags.environment}"` +
    ` --version "${expectedTags.version}"` +
    ` --extension-version ${EXTENSION_LAYER_VERSION}` +
    ` --no-source-code-integration`

  beforeAll(async () => {
    if (!executionRoleArn) {
      throw new Error('AWS_LAMBDA_EXECUTION_ROLE_ARN must be set to run Lambda e2e tests')
    }

    fs.writeFileSync(bootstrapPath, bootstrapSource, {mode: 0o755})
    const zipResult = await execPromise(`zip -j -q "${functionZipPath}" "${bootstrapPath}"`)
    expectCommandToSucceed('Creating Lambda fixture zip', zipResult)

    const createdAt = Math.floor(Date.now() / 1000).toString()
    const createResult = await execPromiseWithRetries(
      `aws lambda create-function` +
        ` --function-name "${functionName}"` +
        ` --runtime provided.al2023` +
        ` --role "${executionRoleArn}"` +
        ` --handler ${originalHandler}` +
        ` --zip-file "fileb://${functionZipPath}"` +
        ` --timeout 30` +
        ` --memory-size 128` +
        ` --architectures x86_64` +
        ` --tags "one_e2e_created=${createdAt}"` +
        ` --region "${region}"` +
        ` --output text`
    )
    expectCommandToSucceed('Creating Lambda function', createResult)
    functionCreated = true

    await waitForFunctionActive(functionName)
  }, 600_000)

  afterAll(async () => {
    if (functionCreated) {
      await deleteFunction(functionName)
    }
    removeTempFiles([functionZipPath, bootstrapPath])
  })

  it('instrument adds only the extension layer', async () => {
    const result = await execPromiseWithRetries(instrumentCommand, instrumentEnv)
    expectCommandToSucceed('Instrumenting Lambda function', result)

    await waitForFunctionUpdated(functionName)
    verifyLambdaExtensionOnly(functionName, region, expectedTags, EXTENSION_LAYER_VERSION, originalHandler)
  }, 600_000)

  it('uninstrument and verify (custom runtime)', async () => {
    const result = await execPromiseWithRetries(
      `${DATADOG_CI_COMMAND} lambda uninstrument -f "${functionName}" -r "${region}"`
    )
    expectCommandToSucceed('Uninstrumenting Lambda function', result)

    await waitForFunctionUpdated(functionName)
    verifyLambdaUninstrumented(functionName, region, originalHandler)
  }, 600_000)
})
