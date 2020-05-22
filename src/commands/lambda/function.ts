import {Lambda} from 'aws-sdk'
import {DEFAULT_LAYER_AWS_ACCOUNT, HANDLER_LOCATION, Runtime, RUNTIME_LAYER_LOOKUP} from './constants'

export interface FunctionConfiguration {
  functionARN: string
  lambdaConfig: Lambda.FunctionConfiguration
  layerARN: string
}

export interface InstrumentationSettings {
  forwarderARN?: string
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
    if (configNeedsUpdating(config, settings, layerARN, runtime)) {
      functionsToUpdate.push({functionARN, layerARN, lambdaConfig: config})
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

  return {config: result.Configuration, functionARN}
}

const updateLambdaConfig = async (
  lambda: Lambda,
  configuration: FunctionConfiguration,
  settings: InstrumentationSettings
) => {
  throw Error('Unimplemented')
}

const getLayerArn = async (lambda: Lambda, runtime: Runtime, settings: InstrumentationSettings) => {
  const {layerVersion, region} = settings
  const layerName = RUNTIME_LAYER_LOOKUP[runtime]
  const account = settings.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}:${layerVersion}`
}

const configNeedsUpdating = async (
  config: Lambda.FunctionConfiguration,
  settings: InstrumentationSettings,
  layerARN: string,
  runtime: Runtime
) => {
  const env = config.Environment?.Variables
  if (env === undefined) {
    return true
  }
  if (env.DD_LAMBDA_HANDLER === undefined) {
    return true
  }
  const expectedHandler = HANDLER_LOCATION[runtime]
  if (config.Handler !== expectedHandler) {
    return true
  }
  const layerARNs = (config.Layers ?? []).map((layer) => layer.Arn)
  if (!layerARNs.includes(layerARN)) {
    return true
  }
  if (env.DATADOG_TRACE_ENABLED !== settings.tracingEnabled.toString()) {
    return true
  }
  if (env.DATADOG_MERGE_XRAY_TRACES !== settings.mergeXrayTraces.toString()) {
    return true
  }

  return false
}
