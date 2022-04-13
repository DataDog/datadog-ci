import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {
  API_KEY_ENV_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  ARM64_ARCHITECTURE,
  CAPTURE_LAMBDA_PAYLOAD_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  CORECLR_ENABLE_PROFILING,
  CORECLR_PROFILER,
  CORECLR_PROFILER_PATH,
  DD_DOTNET_TRACER_HOME,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DOTNET_RUNTIME,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENABLE_PROFILING_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  EXTENSION_LAYER_KEY,
  EXTRA_TAGS_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LAYER_LOOKUP,
  LayerKey,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  NODE_HANDLER_LOCATION,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  PYTHON_HANDLER_LOCATION,
  Runtime,
  RUNTIME_LOOKUP,
  RuntimeType,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  SITES,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
} from '../constants'
import {FunctionConfiguration, InstrumentationSettings, LogGroupConfiguration, TagConfiguration} from '../interfaces'
import {calculateLogGroupUpdateRequest} from '../loggroup'
import {calculateTagUpdateRequest} from '../tags'
import {
  addLayerArn,
  findLatestLayerVersion,
  getLambdaFunctionConfigs,
  getLambdaFunctionConfigsFromRegex,
  getLayerArn,
  getLayers,
  isLambdaActive,
  isLayerRuntime,
  isSupportedRuntime,
} from './commons'

export const getInstrumentedFunctionConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  region: string,
  functionARNs: string[],
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const lambdaFunctionConfigs = await getLambdaFunctionConfigs(lambda, functionARNs)

  const configs: FunctionConfiguration[] = []
  for (const config of lambdaFunctionConfigs) {
    const functionConfig = await getInstrumentedFunctionConfig(lambda, cloudWatch, config, region, settings)

    configs.push(functionConfig)
  }

  return configs
}

export const getInstrumentedFunctionConfig = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  config: Lambda.FunctionConfiguration,
  region: string,
  settings: InstrumentationSettings
): Promise<FunctionConfiguration> => {
  const functionARN = config.FunctionArn!
  const runtime = config.Runtime
  if (!isSupportedRuntime(runtime)) {
    throw Error(`Can't instrument ${functionARN}, runtime ${runtime} not supported`)
  }

  await isLambdaActive(lambda, config, functionARN)
  const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
  let logGroupConfiguration: LogGroupConfiguration | undefined
  if (settings.forwarderARN !== undefined) {
    const logGroupName = `/aws/lambda/${config.FunctionName}`
    logGroupConfiguration = await calculateLogGroupUpdateRequest(cloudWatch, logGroupName, settings.forwarderARN)
  }

  const tagConfiguration: TagConfiguration | undefined = await calculateTagUpdateRequest(lambda, functionARN)

  return {
    functionARN,
    lambdaConfig: config,
    logGroupConfiguration,
    tagConfiguration,
    updateRequest,
  }
}

export const getInstrumentedFunctionConfigsFromRegEx = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  region: string,
  pattern: string,
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambda, pattern)
  const functionsToUpdate: FunctionConfiguration[] = []

  for (const config of matchedFunctions) {
    const functionConfig = await getInstrumentedFunctionConfig(lambda, cloudWatch, config, region, settings)
    functionsToUpdate.push(functionConfig)
  }

  return functionsToUpdate
}

export const calculateUpdateRequest = async (
  config: Lambda.FunctionConfiguration,
  settings: InstrumentationSettings,
  region: string,
  runtime: Runtime
) => {
  const oldEnvVars: Record<string, string> = {...config.Environment?.Variables}
  const changedEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn

  const apiKey: string | undefined = process.env[CI_API_KEY_ENV_VAR]
  const apiKeySecretArn: string | undefined = process.env[CI_API_KEY_SECRET_ARN_ENV_VAR]
  const apiKmsKey: string | undefined = process.env[CI_KMS_API_KEY_ENV_VAR]
  const site: string | undefined = process.env[CI_SITE_ENV_VAR]

  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: Lambda.UpdateFunctionConfigurationRequest = {
    FunctionName: functionARN,
  }
  let needsUpdate = false

  if (
    RUNTIME_LOOKUP[runtime] === RuntimeType.JAVA ||
    RUNTIME_LOOKUP[runtime] === RuntimeType.CUSTOM ||
    RUNTIME_LOOKUP[runtime] === RuntimeType.RUBY
  ) {
    if (settings.layerVersion !== undefined) {
      throw new Error(
        `Only the --extension-version argument should be set for the ${runtime} runtime. Please remove the --layer-version argument from the instrument command.`
      )
    }
  }

  // We don't support ARM Architecture for .NET at this time. Abort instrumentation if the combination is detected.
  if (RUNTIME_LOOKUP[runtime] === RuntimeType.DOTNET) {
    if (config.Architectures?.includes(ARM64_ARCHITECTURE)) {
      throw new Error(
        'Instrumenting arm64 architecture is not currently supported for .NET. Please only instrument .NET functions using x86_64 architecture.'
      )
    }
  }

  // Update Python Handler
  if (RUNTIME_LOOKUP[runtime] === RuntimeType.PYTHON) {
    const expectedHandler = PYTHON_HANDLER_LOCATION
    if (config.Handler !== expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = PYTHON_HANDLER_LOCATION
    }
  }

  // Update Node Handler
  if (RUNTIME_LOOKUP[runtime] === RuntimeType.NODE) {
    const expectedHandler = NODE_HANDLER_LOCATION
    if (config.Handler !== expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = NODE_HANDLER_LOCATION
    }
  }

  // Update Env Vars
  if (RUNTIME_LOOKUP[runtime] === RuntimeType.PYTHON || RUNTIME_LOOKUP[runtime] === RuntimeType.NODE) {
    if (oldEnvVars[LAMBDA_HANDLER_ENV_VAR] === undefined) {
      needsUpdate = true
      changedEnvVars[LAMBDA_HANDLER_ENV_VAR] = config.Handler ?? ''
    }
  }

  // KMS > Secrets Manager > API Key
  if (apiKmsKey !== undefined && oldEnvVars[KMS_API_KEY_ENV_VAR] !== apiKmsKey) {
    needsUpdate = true
    changedEnvVars[KMS_API_KEY_ENV_VAR] = apiKmsKey
  } else if (apiKeySecretArn !== undefined && oldEnvVars[API_KEY_SECRET_ARN_ENV_VAR] !== apiKeySecretArn) {
    const isNode = RUNTIME_LOOKUP[runtime] === RuntimeType.NODE
    const isSendingSynchronousMetrics = settings.extensionVersion === undefined && !settings.flushMetricsToLogs
    if (isSendingSynchronousMetrics && isNode) {
      throw new Error(
        '`apiKeySecretArn` is not supported for Node runtimes when using Synchronous Metrics. Use either `apiKey` or `apiKmsKey`.'
      )
    }
    needsUpdate = true
    changedEnvVars[API_KEY_SECRET_ARN_ENV_VAR] = apiKeySecretArn
  } else if (apiKey !== undefined && oldEnvVars[API_KEY_ENV_VAR] !== apiKey) {
    needsUpdate = true
    changedEnvVars[API_KEY_ENV_VAR] = apiKey
  }

  if (site !== undefined && oldEnvVars[SITE_ENV_VAR] !== site) {
    if (SITES.includes(site.toLowerCase())) {
      needsUpdate = true
      changedEnvVars[SITE_ENV_VAR] = site
    } else {
      throw new Error(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com, or ddog-gov.com.'
      )
    }
  }
  if (site === undefined && oldEnvVars[SITE_ENV_VAR] === undefined) {
    needsUpdate = true
    changedEnvVars[SITE_ENV_VAR] = 'datadoghq.com'
  }

  const environmentVarsTupleArray: [keyof InstrumentationSettings, string][] = [
    ['captureLambdaPayload', CAPTURE_LAMBDA_PAYLOAD_ENV_VAR],
    ['environment', ENVIRONMENT_ENV_VAR],
    ['extraTags', EXTRA_TAGS_ENV_VAR],
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

  // Skip adding DD_FLUSH_TO_LOGS when using Extension
  const isUsingExtension = settings.extensionVersion !== undefined
  if (
    !isUsingExtension &&
    settings.flushMetricsToLogs !== undefined &&
    oldEnvVars[FLUSH_TO_LOG_ENV_VAR] !== settings.flushMetricsToLogs?.toString()
  ) {
    needsUpdate = true
    changedEnvVars[FLUSH_TO_LOG_ENV_VAR] = settings.flushMetricsToLogs!.toString()
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

  if (runtime === DOTNET_RUNTIME) {
    needsUpdate = true
    newEnvVars[ENABLE_PROFILING_ENV_VAR] = CORECLR_ENABLE_PROFILING
    newEnvVars[PROFILER_ENV_VAR] = CORECLR_PROFILER
    newEnvVars[PROFILER_PATH_ENV_VAR] = CORECLR_PROFILER_PATH
    newEnvVars[DOTNET_TRACER_HOME_ENV_VAR] = DD_DOTNET_TRACER_HOME
  }

  updateRequest.Environment = {
    Variables: newEnvVars,
  }

  let layerARNs = getLayers(config)
  const originalLayerARNs = layerARNs
  let needsLayerUpdate = false
  if (isLayerRuntime(runtime)) {
    const lambdaLibraryLayerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
    const lambdaLibraryLayerName = LAYER_LOOKUP[runtime as LayerKey]
    let fullLambdaLibraryLayerARN: string | undefined
    if (settings.layerVersion !== undefined || settings.interactive) {
      let layerVersion = settings.layerVersion
      if (settings.interactive && !settings.layerVersion) {
        layerVersion = await findLatestLayerVersion(config.Runtime as LayerKey, region)
      }
      fullLambdaLibraryLayerARN = `${lambdaLibraryLayerArn}:${layerVersion}`
    }
    layerARNs = addLayerArn(fullLambdaLibraryLayerARN, lambdaLibraryLayerName, layerARNs)
  }

  const lambdaExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region, settings)
  let fullExtensionLayerARN: string | undefined
  if (settings.extensionVersion !== undefined || settings.interactive) {
    let extensionVersion = settings.extensionVersion
    if (settings.interactive && !settings.extensionVersion) {
      extensionVersion = await findLatestLayerVersion(EXTENSION_LAYER_KEY as LayerKey, region)
    }
    fullExtensionLayerARN = `${lambdaExtensionLayerArn}:${extensionVersion}`
  }

  layerARNs = addLayerArn(fullExtensionLayerARN, DD_LAMBDA_EXTENSION_LAYER_NAME, layerARNs)

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
      newEnvVars[API_KEY_SECRET_ARN_ENV_VAR] === undefined &&
      newEnvVars[KMS_API_KEY_ENV_VAR] === undefined
    ) {
      throw new Error(
        `When 'extensionLayer' is set, ${CI_API_KEY_ENV_VAR}, ${CI_KMS_API_KEY_ENV_VAR}, or ${CI_API_KEY_SECRET_ARN_ENV_VAR} must also be set`
      )
    }
  })

  return needsUpdate ? updateRequest : undefined
}
