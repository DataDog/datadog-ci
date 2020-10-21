import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {
  DEFAULT_LAYER_AWS_ACCOUNT,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  HANDLER_LOCATION,
  Runtime,
  RUNTIME_LAYER_LOOKUP,
} from './constants'
import {applyLogGroupConfig, calculateLogGroupUpdateRequest, LogGroupConfiguration} from './loggroup'
import {applyTagConfig, calculateTagUpdateRequest, TagConfiguration} from './tags'

export interface FunctionConfiguration {
  functionARN: string
  lambdaConfig: Lambda.FunctionConfiguration
  layerARN: string
  logGroupConfiguration?: LogGroupConfiguration
  tagConfiguration?: TagConfiguration
  updateRequest?: Lambda.UpdateFunctionConfigurationRequest
}

export interface InstrumentationSettings {
  flushMetricsToLogs: boolean
  forwarderARN?: string
  layerAWSAccount?: string
  layerVersion?: number
  mergeXrayTraces: boolean
  tracingEnabled: boolean
}

export const getLambdaConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  region: string,
  functionARNs: string[],
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const resultPromises = functionARNs.map((fn) => getLambdaConfig(lambda, fn))
  const results = await Promise.all(resultPromises)

  const functionsToUpdate: FunctionConfiguration[] = []

  for (const {config, functionARN} of results) {
    const runtime = config.Runtime
    if (!isSupportedRuntime(runtime)) {
      throw Error(`Can't instrument ${functionARN}, runtime ${runtime} not supported`)
    }

    const layerARN: string = getLayerArn(runtime, settings, region)
    const updateRequest = calculateUpdateRequest(config, settings, layerARN, runtime)
    let logGroupConfiguration: LogGroupConfiguration | undefined
    if (settings.forwarderARN !== undefined) {
      const arn = `/aws/lambda/${config.FunctionName}`
      logGroupConfiguration = await calculateLogGroupUpdateRequest(cloudWatch, arn, settings.forwarderARN)
    }

    const tagConfiguration: TagConfiguration | undefined = await calculateTagUpdateRequest(lambda, functionARN)

    functionsToUpdate.push({
      functionARN,
      lambdaConfig: config,
      layerARN,
      logGroupConfiguration,
      tagConfiguration,
      updateRequest,
    })
  }

  return functionsToUpdate
}

export const updateLambdaConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  configurations: FunctionConfiguration[]
) => {
  const results = configurations.map(async (c) => {
    if (c.updateRequest !== undefined) {
      await lambda.updateFunctionConfiguration(c.updateRequest).promise()
    }
    if (c.logGroupConfiguration !== undefined) {
      await applyLogGroupConfig(cloudWatch, c.logGroupConfiguration)
    }
    if (c.tagConfiguration !== undefined) {
      await applyTagConfig(lambda, c.tagConfiguration)
    }
  })
  await Promise.all(results)
}

const getLambdaConfig = async (
  lambda: Lambda,
  functionARN: string
): Promise<{config: Lambda.FunctionConfiguration; functionARN: string}> => {
  const params = {
    FunctionName: functionARN,
  }
  const result = await lambda.getFunction(params).promise()
  // AWS typescript API is slightly mistyped, adds undefineds where
  // there shouldn't be.
  const config = result.Configuration!
  const resolvedFunctionARN = config.FunctionArn!

  return {config, functionARN: resolvedFunctionARN}
}

const getLayerArn = (runtime: Runtime, settings: InstrumentationSettings, region: string) => {
  const layerName = RUNTIME_LAYER_LOOKUP[runtime]
  const account = settings.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region === 'us-gov-east-1' || region === 'us-gov-west-1'
  if (isGovCloud) {
    return `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerName}`
  }

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

const calculateUpdateRequest = (
  config: Lambda.FunctionConfiguration,
  settings: InstrumentationSettings,
  layerARN: string,
  runtime: Runtime
) => {
  const env: Record<string, string> = {...config.Environment?.Variables}
  const newEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn
  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: Lambda.UpdateFunctionConfigurationRequest = {
    FunctionName: functionARN,
  }
  let needsUpdate = false

  if (env.DD_LAMBDA_HANDLER === undefined) {
    needsUpdate = true
    newEnvVars.DD_LAMBDA_HANDLER = config.Handler ?? ''
  }
  const expectedHandler = HANDLER_LOCATION[runtime]
  if (config.Handler !== expectedHandler) {
    needsUpdate = true
    updateRequest.Handler = HANDLER_LOCATION[runtime]
  }
  const layerARNs = (config.Layers ?? []).map((layer) => layer.Arn ?? '')
  const fullLayerARN = `${layerARN}:${settings.layerVersion}`
  if (!layerARNs.includes(fullLayerARN)) {
    needsUpdate = true
    // Remove any other versions of the layer
    updateRequest.Layers = [...layerARNs.filter((l) => !l.startsWith(layerARN)), fullLayerARN]
  }
  if (env.DD_TRACE_ENABLED !== settings.tracingEnabled.toString()) {
    needsUpdate = true
    newEnvVars.DD_TRACE_ENABLED = settings.tracingEnabled.toString()
  }
  if (env.DD_MERGE_XRAY_TRACES !== settings.mergeXrayTraces.toString()) {
    needsUpdate = true
    newEnvVars.DD_MERGE_XRAY_TRACES = settings.mergeXrayTraces.toString()
  }
  if (env.DD_FLUSH_TO_LOG !== settings.flushMetricsToLogs.toString()) {
    needsUpdate = true
    newEnvVars.DD_FLUSH_TO_LOG = settings.flushMetricsToLogs.toString()
  }
  if (Object.entries(newEnvVars).length > 0) {
    updateRequest.Environment = {
      Variables: {...env, ...newEnvVars},
    }
  }

  return needsUpdate ? updateRequest : undefined
}

const isSupportedRuntime = (runtime?: string): runtime is Runtime => {
  const lookup = RUNTIME_LAYER_LOOKUP as Record<string, string>

  return runtime !== undefined && lookup[runtime] !== undefined
}
