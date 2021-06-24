import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {
  DD_LAMBDA_EXTENSION_LAYER_NAME,
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
  lambdaLibraryLayerArn: string
  logGroupConfiguration?: LogGroupConfiguration
  tagConfiguration?: TagConfiguration
  updateRequest?: Lambda.UpdateFunctionConfigurationRequest
}

export interface InstrumentationSettings {
  extensionVersion?: number
  flushMetricsToLogs: boolean
  forwarderARN?: string
  layerAWSAccount?: string
  layerVersion?: number
  logLevel?: string
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

    const lambdaLibraryLayerArn: string = getLayerArn(runtime, settings, region)
    const lambdaExtensionLayerArn: string = getExtensionArn(settings, region)
    const updateRequest = calculateUpdateRequest(
      config,
      settings,
      lambdaLibraryLayerArn,
      lambdaExtensionLayerArn,
      runtime
    )
    let logGroupConfiguration: LogGroupConfiguration | undefined
    if (settings.forwarderARN !== undefined) {
      const arn = `/aws/lambda/${config.FunctionName}`
      logGroupConfiguration = await calculateLogGroupUpdateRequest(cloudWatch, arn, settings.forwarderARN)
    }

    const tagConfiguration: TagConfiguration | undefined = await calculateTagUpdateRequest(lambda, functionARN)

    functionsToUpdate.push({
      functionARN,
      lambdaConfig: config,
      lambdaLibraryLayerArn,
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

export const getLayerArn = (runtime: Runtime, settings: InstrumentationSettings, region: string) => {
  const layerName = RUNTIME_LAYER_LOOKUP[runtime]
  const account = settings.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region.startsWith('us-gov')
  if (isGovCloud) {
    return `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerName}`
  }

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

export const getExtensionArn = (settings: InstrumentationSettings, region: string) => {
  const layerName = DD_LAMBDA_EXTENSION_LAYER_NAME
  const account = settings.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region.startsWith('us-gov')
  if (isGovCloud) {
    return `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerName}`
  }

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

export const calculateUpdateRequest = (
  config: Lambda.FunctionConfiguration,
  settings: InstrumentationSettings,
  lambdaLibraryLayerArn: string,
  lambdaExtensionLayerArn: string,
  runtime: Runtime
) => {
  const env: Record<string, string> = {...config.Environment?.Variables}
  const newEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn
  const apiKey: string | undefined = process.env.DATADOG_API_KEY
  const apiKmsKey: string | undefined = process.env.DATADOG_KMS_API_KEY
  const site: string | undefined = process.env.DATADOG_SITE
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
  let fullLambdaLibraryLayerARN: string | undefined
  if (settings.layerVersion !== undefined) {
    fullLambdaLibraryLayerARN = `${lambdaLibraryLayerArn}:${settings.layerVersion}`
  }
  let fullExtensionLayerARN: string | undefined
  if (settings.extensionVersion !== undefined) {
    fullExtensionLayerARN = `${lambdaExtensionLayerArn}:${settings.extensionVersion}`
  }
  if (apiKey !== undefined && env.DD_API_KEY !== apiKey) {
    needsUpdate = true
    newEnvVars.DD_API_KEY = apiKey
  }
  if (apiKmsKey !== undefined && env.DD_KMS_API_KEY !== apiKmsKey) {
    needsUpdate = true
    newEnvVars.DD_KMS_API_KEY = apiKmsKey
  }
  if (site !== undefined && env.DD_SITE !== site) {
    const siteList: string[] = ['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'ddog-gov.com']
    if (siteList.includes(site.toLowerCase())) {
      needsUpdate = true
      newEnvVars.DD_SITE = site
    } else {
      throw new Error(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, or ddog-gov.com.'
      )
    }
  }
  if (site === undefined && env.DD_SITE === undefined) {
    needsUpdate = true
    newEnvVars.DD_SITE = 'datadoghq.com'
  }
  let layerARNs = (config.Layers ?? []).map((layer) => layer.Arn ?? '')
  const originalLayerARNs = (config.Layers ?? []).map((layer) => layer.Arn ?? '')
  let needsLayerUpdate = false
  layerARNs = addLayerARN(fullLambdaLibraryLayerARN, lambdaLibraryLayerArn, layerARNs)
  layerARNs = addLayerARN(fullExtensionLayerARN, lambdaExtensionLayerArn, layerARNs)

  if (originalLayerARNs.sort().join(',') !== layerARNs.sort().join(',')) {
    needsLayerUpdate = true
  }
  if (needsLayerUpdate) {
    needsUpdate = true
    updateRequest.Layers = layerARNs
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
  if (settings.logLevel && (env.DD_LOG_LEVEL !== settings.logLevel)) {
    needsUpdate = true
    newEnvVars.DD_LOG_LEVEL = settings.logLevel
  }
  const allEnvVariables = {...env, ...newEnvVars}
  layerARNs.forEach((layerARN) => {
    if (
      layerARN.includes(DD_LAMBDA_EXTENSION_LAYER_NAME) &&
      allEnvVariables.DD_API_KEY === undefined &&
      allEnvVariables.DD_KMS_API_KEY === undefined
    ) {
      throw new Error("When 'extensionLayer' is set, DATADOG_API_KEY or DATADOG_KMS_API_KEY must also be set")
    }
  })
  if (Object.entries(newEnvVars).length > 0) {
    updateRequest.Environment = {
      Variables: allEnvVariables,
    }
  }

  return needsUpdate ? updateRequest : undefined
}

const addLayerARN = (fullLayerARN: string | undefined, partialLayerARN: string, layerARNs: string[]) => {
  if (fullLayerARN) {
    if (!layerARNs.includes(fullLayerARN)) {
      // Remove any other versions of the layer
      layerARNs = [...layerARNs.filter((l) => !l.startsWith(partialLayerARN)), fullLayerARN]
    }
  }

  return layerARNs
}
const isSupportedRuntime = (runtime?: string): runtime is Runtime => {
  const lookup = RUNTIME_LAYER_LOOKUP as Record<string, string>

  return runtime !== undefined && lookup[runtime] !== undefined
}
