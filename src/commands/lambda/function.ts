import {Lambda} from 'aws-sdk'
import deepExtend from 'deep-extend'
import {DEFAULT_LAYER_AWS_ACCOUNT, HANDLER_LOCATION, Runtime, RUNTIME_LAYER_LOOKUP} from './constants'

export interface FunctionConfiguration {
  functionARN: string
  lambdaConfig: Lambda.FunctionConfiguration
  layerARN: string
  updateRequest: Lambda.UpdateFunctionConfigurationRequest
}

export interface InstrumentationSettings {
  layerAWSAccount?: string
  layerVersion?: number
  mergeXrayTraces: boolean
  region: string
  tracingEnabled: boolean
}

export const getLambdaConfigs = async (lambda: Lambda, functionARNs: string[], settings: InstrumentationSettings) => {
  const resultPromises = functionARNs.map((fn) => getLambdaConfig(lambda, fn))
  const results = await Promise.all([...resultPromises])
  const layerARNLookup: {[key: string]: string} = {}
  const functionsToUpdate: FunctionConfiguration[] = []

  for (const {config, functionARN} of results) {
    if (config === undefined) {
      throw Error(`Failed to get config of ${functionARN}`)
    }
    const runtime = config.Runtime as Runtime
    if (runtime === undefined || RUNTIME_LAYER_LOOKUP[runtime] === undefined) {
      throw Error(`Can't instrument ${functionARN}, runtime ${runtime} not supported`)
    }
    let layerARN: string | undefined = layerARNLookup[runtime]
    if (layerARN === undefined) {
      layerARN = await getLayerArn(lambda, runtime, settings)
      if (layerARN === undefined) {
        throw Error(`Couldn't find layer for runtime ${runtime}, used by function ${functionARN}`)
      }
      layerARNLookup[runtime] = layerARN
    }
    const updateRequest = calculateUpdateRequest(config, settings, layerARN, runtime)
    if (updateRequest !== undefined) {
      functionsToUpdate.push({functionARN, layerARN, lambdaConfig: config, updateRequest})
    }
  }

  return functionsToUpdate
}

export const updateLambdaConfigs = async (
  lambda: Lambda,
  configurations: FunctionConfiguration[],
  settings: InstrumentationSettings
) => {
  const results = configurations.map((c) => updateLambdaConfig(lambda, c, settings))
  await Promise.all([...results])
}

const getLambdaConfig = async (lambda: Lambda, functionARN: string) => {
  const params = {
    FunctionName: functionARN,
  }
  const result = await lambda.getFunction(params).promise()

  return {config: result.Configuration, functionARN: result.Configuration?.FunctionArn ?? ''}
}

const updateLambdaConfig = async (
  lambda: Lambda,
  configuration: FunctionConfiguration,
  settings: InstrumentationSettings
) => {
  await lambda.updateFunctionConfiguration(configuration.updateRequest).promise()
}

const getLayerArn = async (lambda: Lambda, runtime: Runtime, settings: InstrumentationSettings) => {
  const {region} = settings
  const layerName = RUNTIME_LAYER_LOOKUP[runtime]
  const account = settings.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

const calculateUpdateRequest = (
  config: Lambda.FunctionConfiguration,
  settings: InstrumentationSettings,
  layerARN: string,
  runtime: Runtime
) => {
  const env = deepExtend({}, config.Environment?.Variables)
  const newEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn
  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: Lambda.UpdateFunctionConfigurationRequest = {
    FunctionName: functionARN,
  }
  let needsUpdate = false

  if (env?.DD_LAMBDA_HANDLER === undefined) {
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
  if (env?.DD_TRACE_ENABLED !== settings.tracingEnabled.toString()) {
    needsUpdate = true
    newEnvVars.DD_TRACE_ENABLED = settings.tracingEnabled.toString()
  }
  if (env?.DD_MERGE_XRAY_TRACES !== settings.mergeXrayTraces.toString()) {
    needsUpdate = true
    newEnvVars.DD_MERGE_XRAY_TRACES = settings.mergeXrayTraces.toString()
  }
  if (Object.entries(newEnvVars).length > 0) {
    updateRequest.Environment = {
      Variables: deepExtend({}, env, newEnvVars),
    }
  }

  return needsUpdate ? updateRequest : undefined
}
