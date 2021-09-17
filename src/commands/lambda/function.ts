import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DEFAULT_LAYER_AWS_ACCOUNT,
  FLUSH_TO_LOG_ENV_VAR,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  HANDLER_LOCATION,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  Runtime,
  RUNTIME_LAYER_LOOKUP,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
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

const MAX_LAMBDA_STATE_CHECKS = 3

/**
 * Waits for n ms
 * @param ms
 * @returns
 */
const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))

const isLambdaActive = async (
  lambda: Lambda,
  config: Lambda.FunctionConfiguration,
  functionArn: string,
  attempts = 0
): Promise<boolean> => {
  // TODO remove 1 Oct 2021 https://aws.amazon.com/blogs/compute/tracking-the-state-of-lambda-functions/
  if (!config.State || !config.LastUpdateStatus) {
    return true
  }
  if (config.LastUpdateStatus === 'Successful' && config.State === 'Active') {
    return true
  }
  if (config.State === 'Pending' && attempts <= MAX_LAMBDA_STATE_CHECKS) {
    await wait(2 ** attempts * 1000)
    const refetchedConfig = await getLambdaConfig(lambda, functionArn)

    return isLambdaActive(lambda, refetchedConfig.config, functionArn, (attempts += 1))
  }
  throw Error(
    `Can't instrument ${functionArn}, as current State is ${config.State} (must be "Active") and Last Update Status is ${config.LastUpdateStatus} (must be "Successful")`
  )
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

    await isLambdaActive(lambda, config, functionARN)
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

export const getLambdaConfigsFromRegEx = async (pattern: string, cloudWatch: CloudWatchLogs, region: string, settings: InstrumentationSettings): Promise<FunctionConfiguration[]> => {
  const re = new RegExp(pattern);
  const lambda = new Lambda({ region })
  const matchedFunctions: Lambda.FunctionConfiguration[] = []
  let nextMarker
  let results = await lambda.listFunctions().promise()
  results.Functions?.map(fn => fn.FunctionName?.match(re) && matchedFunctions.push(fn))

  nextMarker = results.NextMarker
  while (nextMarker) {
    results = await lambda.listFunctions({ Marker: nextMarker }).promise()
    results.Functions?.map(fn => fn.FunctionName?.match(re) && matchedFunctions.push(fn))
    nextMarker = results.NextMarker
  }

  const functionsToUpdate: FunctionConfiguration[] = []

  for (const config of matchedFunctions) {
    const functionARN = config.FunctionArn!
    const runtime = config.Runtime
    if (!isSupportedRuntime(runtime)) {
      throw Error(`Can't instrument ${functionARN}, runtime ${runtime} not supported`)
    }

    await isLambdaActive(lambda, config, functionARN)
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
  const oldEnvVars: Record<string, string> = {...config.Environment?.Variables}
  const changedEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn

  const apiKey: string | undefined = process.env[CI_API_KEY_ENV_VAR]
  const apiKmsKey: string | undefined = process.env[CI_KMS_API_KEY_ENV_VAR]
  const site: string | undefined = process.env[CI_SITE_ENV_VAR]

  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: Lambda.UpdateFunctionConfigurationRequest = {
    FunctionName: functionARN,
  }
  let needsUpdate = false

  // Update Handler
  const expectedHandler = HANDLER_LOCATION[runtime]
  if (config.Handler !== expectedHandler) {
    needsUpdate = true
    updateRequest.Handler = HANDLER_LOCATION[runtime]
  }

  // Update Env Vars
  if (oldEnvVars[LAMBDA_HANDLER_ENV_VAR] === undefined) {
    needsUpdate = true
    changedEnvVars[LAMBDA_HANDLER_ENV_VAR] = config.Handler ?? ''
  }
  if (apiKey !== undefined && oldEnvVars[API_KEY_ENV_VAR] !== apiKey) {
    needsUpdate = true
    changedEnvVars[API_KEY_ENV_VAR] = apiKey
  }
  if (apiKmsKey !== undefined && oldEnvVars[KMS_API_KEY_ENV_VAR] !== apiKmsKey) {
    needsUpdate = true
    changedEnvVars[KMS_API_KEY_ENV_VAR] = apiKmsKey
  }
  if (site !== undefined && oldEnvVars[SITE_ENV_VAR] !== site) {
    const siteList: string[] = ['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'ddog-gov.com']
    if (siteList.includes(site.toLowerCase())) {
      needsUpdate = true
      changedEnvVars[SITE_ENV_VAR] = site
    } else {
      throw new Error(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, or ddog-gov.com.'
      )
    }
  }
  if (site === undefined && oldEnvVars[SITE_ENV_VAR] === undefined) {
    needsUpdate = true
    changedEnvVars[SITE_ENV_VAR] = 'datadoghq.com'
  }
  if (oldEnvVars[TRACE_ENABLED_ENV_VAR] !== settings.tracingEnabled.toString()) {
    needsUpdate = true
    changedEnvVars[TRACE_ENABLED_ENV_VAR] = settings.tracingEnabled.toString()
  }
  if (oldEnvVars[MERGE_XRAY_TRACES_ENV_VAR] !== settings.mergeXrayTraces.toString()) {
    needsUpdate = true
    changedEnvVars[MERGE_XRAY_TRACES_ENV_VAR] = settings.mergeXrayTraces.toString()
  }
  if (oldEnvVars[FLUSH_TO_LOG_ENV_VAR] !== settings.flushMetricsToLogs.toString()) {
    needsUpdate = true
    changedEnvVars[FLUSH_TO_LOG_ENV_VAR] = settings.flushMetricsToLogs.toString()
  }

  const newEnvVars = {...oldEnvVars, ...changedEnvVars}

  if (newEnvVars[LOG_LEVEL_ENV_VAR] !== settings.logLevel) {
    needsUpdate = true
    if (settings.logLevel) {
      newEnvVars[LOG_LEVEL_ENV_VAR] = settings.logLevel
    } else {
      delete newEnvVars[LOG_LEVEL_ENV_VAR]
    }
  }

  updateRequest.Environment = {
    Variables: newEnvVars,
  }

  // Update Layers
  let fullLambdaLibraryLayerARN: string | undefined
  if (settings.layerVersion !== undefined) {
    fullLambdaLibraryLayerARN = `${lambdaLibraryLayerArn}:${settings.layerVersion}`
  }
  let fullExtensionLayerARN: string | undefined
  if (settings.extensionVersion !== undefined) {
    fullExtensionLayerARN = `${lambdaExtensionLayerArn}:${settings.extensionVersion}`
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

  layerARNs.forEach((layerARN) => {
    if (
      layerARN.includes(DD_LAMBDA_EXTENSION_LAYER_NAME) &&
      newEnvVars[API_KEY_ENV_VAR] === undefined &&
      newEnvVars[KMS_API_KEY_ENV_VAR] === undefined
    ) {
      throw new Error(
        `When 'extensionLayer' is set, ${CI_API_KEY_ENV_VAR} or ${CI_KMS_API_KEY_ENV_VAR} must also be set`
      )
    }
  })

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
