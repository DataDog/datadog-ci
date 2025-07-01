import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {
  LambdaClient,
  FunctionConfiguration as LFunctionConfiguration,
  Runtime,
  UpdateFunctionConfigurationCommandInput,
} from '@aws-sdk/client-lambda'

import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
} from '../../../constants'
import {isValidDatadogSite} from '../../../helpers/validation'

import {
  API_KEY_SECRET_ARN_ENV_VAR,
  ARM64_ARCHITECTURE,
  AWS_LAMBDA_EXEC_WRAPPER,
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  CAPTURE_LAMBDA_PAYLOAD_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CORECLR_ENABLE_PROFILING,
  CORECLR_PROFILER,
  CORECLR_PROFILER_PATH,
  DD_DOTNET_TRACER_HOME,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENABLE_PROFILING_ENV_VAR,
  EXTENSION_LAYER_KEY,
  FLUSH_TO_LOG_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LayerKey,
  LAYER_LOOKUP,
  LOG_ENABLED_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  NODE_HANDLER_LOCATION,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  PYTHON_HANDLER_LOCATION,
  RuntimeType,
  RUNTIME_LOOKUP,
  APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR,
  APPSEC_ENABLED_ENV_VAR,
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
  isLayerRuntime,
  isSupportedRuntime,
} from './commons'
import {isExtensionCompatibleWithUniversalInstrumentation, isTracerCompatibleWithExtension} from './versionChecker'

export const getInstrumentedFunctionConfigs = async (
  lambdaClient: LambdaClient,
  cloudWatchLogsClient: CloudWatchLogsClient,
  region: string,
  functionARNs: string[],
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const lambdaFunctionConfigs = await getLambdaFunctionConfigs(lambdaClient, functionARNs)

  const configs: FunctionConfiguration[] = []
  for (const config of lambdaFunctionConfigs) {
    const functionConfig = await getInstrumentedFunctionConfig(
      lambdaClient,
      cloudWatchLogsClient,
      config,
      region,
      settings
    )

    configs.push(functionConfig)
  }

  return configs
}

export const getInstrumentedFunctionConfig = async (
  lambdaClient: LambdaClient,
  cloudWatchLogsClient: CloudWatchLogsClient,
  config: LFunctionConfiguration,
  region: string,
  settings: InstrumentationSettings
): Promise<FunctionConfiguration> => {
  const functionARN = config.FunctionArn!
  const runtime = config.Runtime
  if (!isSupportedRuntime(runtime)) {
    throw Error(`Can't instrument ${functionARN}, runtime ${runtime} not supported`)
  }

  const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
  let logGroupConfiguration: LogGroupConfiguration | undefined
  if (settings.forwarderARN !== undefined) {
    const logGroupName = `/aws/lambda/${config.FunctionName}`
    logGroupConfiguration = await calculateLogGroupUpdateRequest(
      cloudWatchLogsClient,
      logGroupName,
      settings.forwarderARN
    )
  }

  const tagConfiguration: TagConfiguration | undefined = await calculateTagUpdateRequest(lambdaClient, functionARN)

  return {
    functionARN,
    lambdaConfig: config,
    logGroupConfiguration,
    tagConfiguration,
    updateFunctionConfigurationCommandInput: updateRequest,
  }
}

export const getInstrumentedFunctionConfigsFromRegEx = async (
  lambdaClient: LambdaClient,
  cloudWatchLogsClient: CloudWatchLogsClient,
  region: string,
  pattern: string,
  settings: InstrumentationSettings
): Promise<FunctionConfiguration[]> => {
  const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambdaClient, pattern)
  const functionsToUpdate: FunctionConfiguration[] = []

  for (const config of matchedFunctions) {
    const functionConfig = await getInstrumentedFunctionConfig(
      lambdaClient,
      cloudWatchLogsClient,
      config,
      region,
      settings
    )
    functionsToUpdate.push(functionConfig)
  }

  return functionsToUpdate
}

export const calculateUpdateRequest = async (
  config: LFunctionConfiguration,
  settings: InstrumentationSettings,
  region: string,
  runtime: Runtime
): Promise<UpdateFunctionConfigurationCommandInput | undefined> => {
  const oldEnvVars: Record<string, string> = {...config.Environment?.Variables}
  const changedEnvVars: Record<string, string> = {}
  const functionARN = config.FunctionArn

  const apiKey: string | undefined = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
  const apiKeySecretArn: string | undefined = process.env[CI_API_KEY_SECRET_ARN_ENV_VAR]
  const apiKmsKey: string | undefined = process.env[CI_KMS_API_KEY_ENV_VAR]
  const site: string | undefined = process.env[CI_SITE_ENV_VAR]

  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: UpdateFunctionConfigurationCommandInput = {
    FunctionName: functionARN,
  }
  let needsUpdate = false
  const runtimeType = RUNTIME_LOOKUP[runtime]

  if (runtimeType === RuntimeType.CUSTOM) {
    if (settings.layerVersion !== undefined) {
      throw new Error(
        `Only the --extension-version argument should be set for the ${runtime} runtime. Please remove the --layer-version argument from the instrument command.`
      )
    }
  }

  // Update Python Handler
  if (runtimeType === RuntimeType.PYTHON && (settings.layerVersion !== undefined || settings.interactive)) {
    const expectedHandler = PYTHON_HANDLER_LOCATION
    if (config.Handler !== expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = PYTHON_HANDLER_LOCATION
    }
  }

  // Update Node Handler
  if (runtimeType === RuntimeType.NODE && (settings.layerVersion !== undefined || settings.interactive)) {
    const expectedHandler = NODE_HANDLER_LOCATION
    if (config.Handler !== expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = NODE_HANDLER_LOCATION
    }
  }

  // Update Env Vars
  if (runtimeType === RuntimeType.PYTHON || runtimeType === RuntimeType.NODE) {
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
    const isNode = runtimeType === RuntimeType.NODE
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
    if (isValidDatadogSite(site)) {
      needsUpdate = true
      changedEnvVars[SITE_ENV_VAR] = site
    } else {
      throw new Error(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com, ap1.datadoghq.com, ap2.datadoghq.com, or ddog-gov.com.'
      )
    }
  }
  if (site === undefined && oldEnvVars[SITE_ENV_VAR] === undefined) {
    needsUpdate = true
    changedEnvVars[SITE_ENV_VAR] = 'datadoghq.com'
  }

  const environmentVarsTupleArray: [keyof InstrumentationSettings, string][] = [
    ['apmFlushDeadline', APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR],
    ['appsecEnabled', APPSEC_ENABLED_ENV_VAR],
    ['captureLambdaPayload', CAPTURE_LAMBDA_PAYLOAD_ENV_VAR],
    ['environment', ENVIRONMENT_ENV_VAR],
    ['extraTags', DD_TAGS_ENV_VAR],
    ['loggingEnabled', LOG_ENABLED_ENV_VAR],
    ['mergeXrayTraces', MERGE_XRAY_TRACES_ENV_VAR],
    ['service', SERVICE_ENV_VAR],
    ['tracingEnabled', TRACE_ENABLED_ENV_VAR],
    ['version', VERSION_ENV_VAR],
    ['llmobsMlApp', DD_LLMOBS_ML_APP_ENV_VAR],
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

  // Enable ASM
  if (settings['appsecEnabled'] === true) {
    newEnvVars[AWS_LAMBDA_EXEC_WRAPPER_VAR] = AWS_LAMBDA_EXEC_WRAPPER
  }

  // Enable LLMObs
  if (settings['llmobsMlApp'] !== undefined) {
    newEnvVars[DD_LLMOBS_ENABLED_ENV_VAR] = 'true'
    newEnvVars[DD_LLMOBS_ML_APP_ENV_VAR] = settings['llmobsMlApp']

    // For LLM Observability to use the agent from the extension layer as a proxy.
    // LLM Observability setup documentation will point to the `-e` extension layer option to
    // always use the extension layer.
    newEnvVars[DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR] = 'false'
  }

  let layerARNs = getLayers(config)
  const originalLayerARNs = layerARNs
  let needsLayerUpdate = false
  let layerOrTraceVersion: number | undefined
  if (isLayerRuntime(runtime)) {
    const lambdaLibraryLayerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
    const lambdaLibraryLayerName = LAYER_LOOKUP[runtime as LayerKey]
    let fullLambdaLibraryLayerARN: string | undefined
    if (settings.layerVersion !== undefined || settings.interactive) {
      layerOrTraceVersion = settings.layerVersion
      if (settings.interactive && !settings.layerVersion) {
        layerOrTraceVersion = await findLatestLayerVersion(config.Runtime as LayerKey, region)
      }
      fullLambdaLibraryLayerARN = `${lambdaLibraryLayerArn}:${layerOrTraceVersion}`
    }
    layerARNs = addLayerArn(fullLambdaLibraryLayerARN, lambdaLibraryLayerName, layerARNs)
  }

  const lambdaExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region, settings)
  let fullExtensionLayerARN: string | undefined
  let extensionVersion: number | undefined
  if (settings.extensionVersion !== undefined || settings.interactive) {
    extensionVersion = settings.extensionVersion
    if (settings.interactive && !settings.extensionVersion) {
      extensionVersion = await findLatestLayerVersion(EXTENSION_LAYER_KEY as LayerKey, region)
    }
    fullExtensionLayerARN = `${lambdaExtensionLayerArn}:${extensionVersion}`
  }
  layerARNs = addLayerArn(fullExtensionLayerARN, DD_LAMBDA_EXTENSION_LAYER_NAME, layerARNs)

  // Special handling for .NET and Java to support universal instrumentation
  if (runtimeType === RuntimeType.DOTNET || runtimeType === RuntimeType.JAVA) {
    if (layerOrTraceVersion && isExtensionCompatibleWithUniversalInstrumentation(runtimeType, extensionVersion)) {
      // If the user configures the trace version and the extension support univeral instrumenation
      // Then check whether the trace and extension are compatible with each other
      if (isTracerCompatibleWithExtension(runtimeType, layerOrTraceVersion)) {
        needsUpdate = true
        newEnvVars[AWS_LAMBDA_EXEC_WRAPPER_VAR] = AWS_LAMBDA_EXEC_WRAPPER
      } else {
        throw new Error(
          `For the ${runtime} runtime, the dd-trace version ${layerOrTraceVersion} is not compatible with the dd-extension version ${extensionVersion}`
        )
      }
    } else if (runtimeType === RuntimeType.DOTNET) {
      // If it is an old extension version or the trace version is null, leave it is as the old workflow
      if (
        !isExtensionCompatibleWithUniversalInstrumentation(runtimeType, extensionVersion) &&
        config.Architectures?.includes(ARM64_ARCHITECTURE)
      ) {
        throw new Error(
          'Instrumenting arm64 architecture is not supported for the given dd-extension version. Please choose the latest dd-extension version or use x86_64 architecture.'
        )
      } else {
        needsUpdate = true
        newEnvVars[ENABLE_PROFILING_ENV_VAR] = CORECLR_ENABLE_PROFILING
        newEnvVars[PROFILER_ENV_VAR] = CORECLR_PROFILER
        newEnvVars[PROFILER_PATH_ENV_VAR] = CORECLR_PROFILER_PATH
        newEnvVars[DOTNET_TRACER_HOME_ENV_VAR] = DD_DOTNET_TRACER_HOME
      }
    }
  }

  updateRequest.Environment = {
    Variables: newEnvVars,
  }

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
