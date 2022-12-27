import {CloudWatchLogs, Lambda} from 'aws-sdk'

import {
  API_KEY_ENV_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  CAPTURE_LAMBDA_PAYLOAD_ENV_VAR,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENABLE_PROFILING_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  KMS_API_KEY_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LayerKey,
  LAYER_LOOKUP,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  NODE_HANDLER_LOCATION,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  PYTHON_HANDLER_LOCATION,
  Runtime,
  RuntimeType,
  RUNTIME_LOOKUP,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  AWS_LAMBDA_EXEC_WRAPPER,
} from '../constants'
import {FunctionConfiguration, LogGroupConfiguration, TagConfiguration} from '../interfaces'
import {calculateLogGroupRemoveRequest} from '../loggroup'
import {calculateTagRemoveRequest} from '../tags'

import {getLambdaFunctionConfigs, getLambdaFunctionConfigsFromRegex, getLayers, isSupportedRuntime} from './commons'

export const getUninstrumentedFunctionConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  functionARNs: string[],
  forwarderARN: string | undefined
): Promise<FunctionConfiguration[]> => {
  const lambdaFunctionConfigs = await getLambdaFunctionConfigs(lambda, functionARNs)

  const configs: FunctionConfiguration[] = []
  for (const config of lambdaFunctionConfigs) {
    const functionConfig = await getUninstrumentedFunctionConfig(lambda, cloudWatch, config, forwarderARN)

    configs.push(functionConfig)
  }

  return configs
}

export const getUninstrumentedFunctionConfig = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  config: Lambda.FunctionConfiguration,
  forwarderARN: string | undefined
): Promise<FunctionConfiguration> => {
  const functionARN = config.FunctionArn!
  const runtime = config.Runtime
  if (!isSupportedRuntime(runtime)) {
    throw Error(`Can't un-instrument ${functionARN}, runtime ${runtime} not supported`)
  }

  const updateRequest = calculateUpdateRequest(config, runtime)
  let logGroupConfiguration: LogGroupConfiguration | undefined
  if (forwarderARN) {
    const logGroupName = `/aws/lambda/${config.FunctionName}`
    logGroupConfiguration = await calculateLogGroupRemoveRequest(cloudWatch, logGroupName, forwarderARN)
  }

  const tagConfiguration: TagConfiguration | undefined = await calculateTagRemoveRequest(lambda, functionARN)

  return {
    functionARN,
    lambdaConfig: config,
    logGroupConfiguration,
    tagConfiguration,
    updateRequest,
  }
}

export const getUninstrumentedFunctionConfigsFromRegEx = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  pattern: string,
  forwarderArn: string | undefined
): Promise<FunctionConfiguration[]> => {
  const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambda, pattern)
  const functionsToUpdate: FunctionConfiguration[] = []

  for (const config of matchedFunctions) {
    const functionConfig = await getUninstrumentedFunctionConfig(lambda, cloudWatch, config, forwarderArn)
    functionsToUpdate.push(functionConfig)
  }

  return functionsToUpdate
}

export const calculateUpdateRequest = (config: Lambda.FunctionConfiguration, runtime: Runtime) => {
  const oldEnvVars: Record<string, string> = {...config.Environment?.Variables}
  const functionARN = config.FunctionArn

  if (functionARN === undefined) {
    return undefined
  }

  const updateRequest: Lambda.UpdateFunctionConfigurationRequest = {
    FunctionName: functionARN,
  }
  let needsUpdate = false

  const runtimeType = RUNTIME_LOOKUP[runtime]
  // Remove Handler for Python
  if (runtimeType === RuntimeType.PYTHON) {
    const expectedHandler = PYTHON_HANDLER_LOCATION
    if (config.Handler === expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = oldEnvVars[LAMBDA_HANDLER_ENV_VAR]
      delete oldEnvVars[LAMBDA_HANDLER_ENV_VAR]
    }
  }

  // Remove Handler for Node
  if (runtimeType === RuntimeType.NODE) {
    const expectedHandler = NODE_HANDLER_LOCATION
    if (config.Handler === expectedHandler) {
      needsUpdate = true
      updateRequest.Handler = oldEnvVars[LAMBDA_HANDLER_ENV_VAR]
      delete oldEnvVars[LAMBDA_HANDLER_ENV_VAR]
    }
  }

  // Remove AWS_LAMBDA_EXEC_WRAPPER for .NET and Java
  if (runtimeType === RuntimeType.DOTNET || runtimeType === RuntimeType.JAVA) {
    if (oldEnvVars[AWS_LAMBDA_EXEC_WRAPPER_VAR] === AWS_LAMBDA_EXEC_WRAPPER) {
      needsUpdate = true
      delete oldEnvVars[AWS_LAMBDA_EXEC_WRAPPER_VAR]
    }
  }

  /**
   * Array used to remove environment vars used in
   * the Lambda environment.
   */
  const environmentVarsArray = [
    API_KEY_ENV_VAR,
    API_KEY_SECRET_ARN_ENV_VAR,
    KMS_API_KEY_ENV_VAR,
    SITE_ENV_VAR,
    CAPTURE_LAMBDA_PAYLOAD_ENV_VAR,
    ENVIRONMENT_ENV_VAR,
    EXTRA_TAGS_ENV_VAR,
    FLUSH_TO_LOG_ENV_VAR,
    MERGE_XRAY_TRACES_ENV_VAR,
    LOG_LEVEL_ENV_VAR,
    SERVICE_ENV_VAR,
    TRACE_ENABLED_ENV_VAR,
    VERSION_ENV_VAR,
    ENABLE_PROFILING_ENV_VAR,
    PROFILER_ENV_VAR,
    PROFILER_PATH_ENV_VAR,
    DOTNET_TRACER_HOME_ENV_VAR,
  ]
  // Remove Environment Variables
  for (const environmentVar of environmentVarsArray) {
    if (oldEnvVars[environmentVar]) {
      needsUpdate = true
      delete oldEnvVars[environmentVar]
    }
  }

  updateRequest.Environment = {
    Variables: oldEnvVars,
  }

  // Remove Layers
  let needsLayerRemoval = false
  const lambdaLibraryLayerName = LAYER_LOOKUP[runtime as LayerKey]
  const originalLayerARNs = getLayers(config)
  const layerARNs = (config.Layers ?? [])
    .filter(
      (layer) => !layer.Arn?.includes(lambdaLibraryLayerName) && !layer.Arn?.includes(DD_LAMBDA_EXTENSION_LAYER_NAME)
    )
    .map((layer) => layer.Arn ?? '')

  if (originalLayerARNs.sort().join(',') !== layerARNs.sort().join(',')) {
    needsLayerRemoval = true
  }
  if (needsLayerRemoval) {
    needsUpdate = true
    updateRequest.Layers = layerARNs
  }

  return needsUpdate ? updateRequest : undefined
}
