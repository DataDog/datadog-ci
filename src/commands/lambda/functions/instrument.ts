import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DEFAULT_LAYER_AWS_ACCOUNT,
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  HANDLER_LOCATION,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LIST_FUNCTIONS_MAX_RETRY_COUNT,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  Runtime,
  RUNTIME_LAYER_LOOKUP,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
} from '../constants'
import {FunctionConfiguration, InstrumentationSettings, LogGroupConfiguration, TagConfiguration} from '../interfaces'
import {calculateLogGroupUpdateRequest} from '../loggroup'
import {calculateTagUpdateRequest} from '../tags'
import {addLayerARN, getLambdaFunctionConfigs, isSupportedRuntime} from './commons'

export const getFunctionConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  region: string,
  functionARNs: string[],
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const lambdaFunctionConfigs = await getLambdaFunctionConfigs(lambda, functionARNs)

  const configs: FunctionConfiguration[] = []
  for (const config of lambdaFunctionConfigs) {
    const functionConfig = await getFunctionConfig(lambda, cloudWatch, config, region, settings)

    configs.push(functionConfig)
  }

  return configs
}

export const getFunctionConfig = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  config: Lambda.FunctionConfiguration,
  region: string,
  settings: InstrumentationSettings
) => {
  const functionARN = config.FunctionArn!
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

  return {
    functionARN,
    lambdaConfig: config,
    lambdaLibraryLayerArn,
    logGroupConfiguration,
    tagConfiguration,
    updateRequest,
  }
}

export const getLambdaConfigsFromRegEx = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  region: string,
  pattern: string,
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const regEx = new RegExp(pattern)
  const matchedFunctions: Lambda.FunctionConfiguration[] = []
  let retryCount = 0
  let listFunctionsResponse: Lambda.ListFunctionsResponse
  let nextMarker: string | undefined

  while (true) {
    try {
      listFunctionsResponse = await lambda.listFunctions({Marker: nextMarker}).promise()
      listFunctionsResponse.Functions?.map((fn) => fn.FunctionName?.match(regEx) && matchedFunctions.push(fn))
      nextMarker = listFunctionsResponse.NextMarker
      if (!nextMarker) {
        break
      }
      retryCount = 0
    } catch (e) {
      retryCount++
      if (retryCount > LIST_FUNCTIONS_MAX_RETRY_COUNT) {
        throw Error('Max retry count exceeded.')
      }
    }
  }

  const functionsToUpdate: FunctionConfiguration[] = []

  for (const config of matchedFunctions) {
    const functionConfig = await getFunctionConfig(lambda, cloudWatch, config, region, settings)
    functionsToUpdate.push(functionConfig)
  }

  return functionsToUpdate
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

  const environmentVarsTupleArray: [keyof InstrumentationSettings, string][] = [
    ['environment', ENVIRONMENT_ENV_VAR],
    ['extraTags', EXTRA_TAGS_ENV_VAR],
    ['flushMetricsToLogs', FLUSH_TO_LOG_ENV_VAR],
    ['mergeXrayTraces', MERGE_XRAY_TRACES_ENV_VAR],
    ['service', SERVICE_ENV_VAR],
    ['tracingEnabled', TRACE_ENABLED_ENV_VAR],
    ['version', VERSION_ENV_VAR],
  ]

  for (const [key, environmentVar] of environmentVarsTupleArray) {
    if (settings[key] !== undefined && oldEnvVars[environmentVar] !== settings[key]?.toString()) {
      needsUpdate = true
      changedEnvVars[environmentVar] = settings[key]!.toString()
    }
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
