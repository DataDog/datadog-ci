import {client, v2} from '@datadog/datadog-api-client'

import {execSync} from './exec'

interface LambdaFunctionConfiguration {
  FunctionArn: string
  Handler?: string
  Environment?: {
    Variables?: Record<string, string>
  }
  Layers?: {Arn?: string}[]
}

interface LambdaTags {
  Tags?: Record<string, string>
}

const DATADOG_NODE_HANDLER = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'
const ORIGINAL_HANDLER = 'index.handler'
const SERVERLESS_CI_TAG = 'dd_sls_ci'
const NODE_LAYER_NAME = 'Datadog-Node24-x'
const EXTENSION_LAYER_NAME = 'Datadog-Extension'

const getFunctionConfiguration = (functionName: string, region: string): LambdaFunctionConfiguration => {
  const output = execSync(
    `aws lambda get-function-configuration --function-name "${functionName}" --region "${region}" --output json`
  )

  return JSON.parse(output)
}

const getTags = (functionArn: string, region: string): Record<string, string> => {
  const output = execSync(`aws lambda list-tags --resource "${functionArn}" --region "${region}" --output json`)
  const response: LambdaTags = JSON.parse(output)

  return response.Tags ?? {}
}

const getLayerArns = (config: LambdaFunctionConfiguration): string[] =>
  (config.Layers ?? []).map((layer) => layer.Arn ?? '')

const hasLayer = (layerArns: string[], layerName: string): boolean =>
  layerArns.some((layerArn) => layerArn.includes(`:layer:${layerName}:`))

export const verifyLambdaInstrumented = (
  functionName: string,
  region: string,
  expectedTags: {environment: string; service: string; version: string}
): void => {
  console.log(`Fetching Lambda function "${functionName}"...`)
  const config = getFunctionConfiguration(functionName, region)
  console.log('\nVerifying instrumented Lambda state:\n')

  const env = config.Environment?.Variables ?? {}
  const layerArns = getLayerArns(config)
  const tags = getTags(config.FunctionArn, region)

  expect(hasLayer(layerArns, NODE_LAYER_NAME)).toBe(true)
  expect(hasLayer(layerArns, EXTENSION_LAYER_NAME)).toBe(true)
  expect(config.Handler).toBe(DATADOG_NODE_HANDLER)
  expect(env.DD_LAMBDA_HANDLER).toBe(ORIGINAL_HANDLER)
  expect(env.DD_SERVICE).toBe(expectedTags.service)
  expect(env.DD_ENV).toBe(expectedTags.environment)
  expect(env.DD_VERSION).toBe(expectedTags.version)
  expect(env.DD_API_KEY).toBeDefined()
  expect(env.DD_SITE).toBeDefined()
  expect(Object.keys(tags)).toContain(SERVERLESS_CI_TAG)

  console.log('\nAll instrumented Lambda checks passed.')
}

const POLL_INTERVAL_SECONDS = 15
const MAX_ATTEMPTS = 20

const waitFor = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

const pollUntilFound = async (label: string, query: () => Promise<unknown[]>): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${label}] attempt ${attempt}/${MAX_ATTEMPTS}`)
    try {
      const results = await query()
      if (results.length > 0) {
        console.log(`[${label}] found ${results.length} item(s)`)

        return
      }
    } catch (error) {
      console.error(`[${label}] query error:`, error)
    }

    if (attempt < MAX_ATTEMPTS) {
      console.log(`[${label}] not found, retrying in ${POLL_INTERVAL_SECONDS}s`)
      await waitFor(POLL_INTERVAL_SECONDS)
    }
  }
  throw new Error(`[${label}] timed out after ${MAX_ATTEMPTS} attempts (${MAX_ATTEMPTS * POLL_INTERVAL_SECONDS}s)`)
}

const querySpans = async (configuration: client.Configuration, serviceName: string): Promise<unknown[]> => {
  const api = new v2.SpansApi(configuration)
  const now = new Date()
  const from = new Date(now.getTime() - 15 * 60 * 1000)
  const response = await api.listSpans({
    body: {
      data: {
        attributes: {
          filter: {
            query: `@service:${serviceName}`,
            from: from.toISOString(),
            to: now.toISOString(),
          },
          page: {limit: 5},
        },
        type: 'search_request',
      },
    },
  })

  return response.data ?? []
}

const queryLogs = async (configuration: client.Configuration, serviceName: string): Promise<unknown[]> => {
  const api = new v2.LogsApi(configuration)
  const now = new Date()
  const from = new Date(now.getTime() - 15 * 60 * 1000)
  const response = await api.listLogs({
    body: {
      filter: {
        query: `service:${serviceName}`,
        from: from.toISOString(),
        to: now.toISOString(),
      },
      page: {limit: 5},
    },
  })

  return response.data ?? []
}

export const checkTelemetryFlowing = async (serviceName: string): Promise<void> => {
  const configuration = client.createConfiguration({
    authMethods: {
      apiKeyAuth: process.env.DATADOG_API_KEY,
      appKeyAuth: process.env.DATADOG_APP_KEY,
    },
  })
  await Promise.all([
    pollUntilFound('spans', () => querySpans(configuration, serviceName)),
    pollUntilFound('logs', () => queryLogs(configuration, serviceName)),
  ])
}

export const verifyLambdaUninstrumented = (functionName: string, region: string): void => {
  console.log(`Fetching Lambda function "${functionName}"...`)
  const config = getFunctionConfiguration(functionName, region)
  console.log('\nVerifying uninstrumented Lambda state:\n')

  const env = config.Environment?.Variables ?? {}
  const layerArns = getLayerArns(config)
  const tags = getTags(config.FunctionArn, region)

  expect(hasLayer(layerArns, NODE_LAYER_NAME)).toBe(false)
  expect(hasLayer(layerArns, EXTENSION_LAYER_NAME)).toBe(false)
  expect(config.Handler).toBe(ORIGINAL_HANDLER)
  expect(Object.keys(env).filter((name) => name.startsWith('DD_'))).toHaveLength(0)
  expect(Object.keys(tags)).not.toContain(SERVERLESS_CI_TAG)

  console.log('\nAll uninstrumented Lambda checks passed.')
}
