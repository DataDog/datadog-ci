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

export interface LambdaSnapshot {
  handler?: string
  env: Record<string, string>
  layerArns: string[]
  tags: Record<string, string>
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

const countLayers = (layerArns: string[], layerName: string): number =>
  layerArns.filter((layerArn) => layerArn.includes(`:layer:${layerName}:`)).length

// Layer ARNs end in `:layer:<name>:<version>` -- pull the trailing version number.
const getLayerVersion = (layerArns: string[], layerName: string): number | undefined => {
  const arn = layerArns.find((layerArn) => layerArn.includes(`:layer:${layerName}:`))
  const match = arn?.match(new RegExp(`:layer:${layerName}:(\\d+)$`))

  return match ? Number(match[1]) : undefined
}

// Capture the instrumentation-relevant state so two snapshots can be compared for equality.
// Layer ARNs are sorted because AWS does not guarantee ordering across calls.
export const getLambdaSnapshot = (functionName: string, region: string): LambdaSnapshot => {
  const config = getFunctionConfiguration(functionName, region)

  return {
    handler: config.Handler,
    env: config.Environment?.Variables ?? {},
    layerArns: getLayerArns(config).sort(),
    tags: getTags(config.FunctionArn, region),
  }
}

export const verifyLambdaInstrumented = (
  functionName: string,
  region: string,
  expectedTags: {environment: string; service: string; version: string},
  expectedLayerVersions: {node: number; extension: number}
): void => {
  console.log(`Fetching Lambda function "${functionName}"...`)
  const config = getFunctionConfiguration(functionName, region)
  console.log('\nVerifying instrumented Lambda state:\n')

  const env = config.Environment?.Variables ?? {}
  const layerArns = getLayerArns(config)
  const tags = getTags(config.FunctionArn, region)

  // Exactly one of each DD layer -- re-instrument must not duplicate layers (idempotent).
  expect(countLayers(layerArns, NODE_LAYER_NAME)).toBe(1)
  expect(countLayers(layerArns, EXTENSION_LAYER_NAME)).toBe(1)
  // The deployed layer versions must match what the instrument command requested.
  expect(getLayerVersion(layerArns, NODE_LAYER_NAME)).toBe(expectedLayerVersions.node)
  expect(getLayerVersion(layerArns, EXTENSION_LAYER_NAME)).toBe(expectedLayerVersions.extension)
  expect(config.Handler).toBe(DATADOG_NODE_HANDLER)
  expect(env.DD_LAMBDA_HANDLER).toBe(ORIGINAL_HANDLER)
  expect(env.DD_SERVICE).toBe(expectedTags.service)
  expect(env.DD_ENV).toBe(expectedTags.environment)
  expect(env.DD_VERSION).toBe(expectedTags.version)
  expect(env.DD_TRACE_ENABLED).toBe('true')
  expect(env.DD_API_KEY).toBeDefined()
  expect(env.DD_SITE).toBeDefined()
  expect(Object.keys(tags)).toContain(SERVERLESS_CI_TAG)

  console.log('\nAll instrumented Lambda checks passed.')
}

// Extension-only instrumentation: a custom runtime (provided.al2023) has no language layer,
// so the CLI adds only the extension and leaves the handler untouched.
export const verifyLambdaExtensionOnly = (
  functionName: string,
  region: string,
  expectedTags: {environment: string; service: string; version: string},
  expectedExtensionVersion: number,
  originalHandler: string
): void => {
  console.log(`Fetching Lambda function "${functionName}"...`)
  const config = getFunctionConfiguration(functionName, region)
  console.log('\nVerifying extension-only Lambda state:\n')

  const env = config.Environment?.Variables ?? {}
  const layerArns = getLayerArns(config)
  const tags = getTags(config.FunctionArn, region)

  // Exactly the extension layer, at the requested version, and no language layer.
  expect(countLayers(layerArns, EXTENSION_LAYER_NAME)).toBe(1)
  expect(getLayerVersion(layerArns, EXTENSION_LAYER_NAME)).toBe(expectedExtensionVersion)
  expect(hasLayer(layerArns, NODE_LAYER_NAME)).toBe(false)
  // No language layer means no handler rewrite.
  expect(config.Handler).toBe(originalHandler)
  expect(env.DD_LAMBDA_HANDLER).toBeUndefined()
  expect(env.DD_SERVICE).toBe(expectedTags.service)
  expect(env.DD_ENV).toBe(expectedTags.environment)
  expect(env.DD_VERSION).toBe(expectedTags.version)
  expect(env.DD_API_KEY).toBeDefined()
  expect(env.DD_SITE).toBeDefined()
  expect(Object.keys(tags)).toContain(SERVERLESS_CI_TAG)

  console.log('\nAll extension-only Lambda checks passed.')
}

export const verifyLambdaUninstrumented = (
  functionName: string,
  region: string,
  originalHandler: string = ORIGINAL_HANDLER
): void => {
  console.log(`Fetching Lambda function "${functionName}"...`)
  const config = getFunctionConfiguration(functionName, region)
  console.log('\nVerifying uninstrumented Lambda state:\n')

  const env = config.Environment?.Variables ?? {}
  const layerArns = getLayerArns(config)
  const tags = getTags(config.FunctionArn, region)

  expect(hasLayer(layerArns, NODE_LAYER_NAME)).toBe(false)
  expect(hasLayer(layerArns, EXTENSION_LAYER_NAME)).toBe(false)
  expect(config.Handler).toBe(originalHandler)
  expect(Object.keys(env).filter((name) => name.startsWith('DD_'))).toHaveLength(0)
  expect(Object.keys(tags)).not.toContain(SERVERLESS_CI_TAG)

  console.log('\nAll uninstrumented Lambda checks passed.')
}
