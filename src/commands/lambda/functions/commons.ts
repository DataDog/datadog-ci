import {CloudWatchLogs, config as aws_sdk_config, Lambda} from 'aws-sdk'
import {GetFunctionRequest} from 'aws-sdk/clients/lambda'
import {
  ARM64_ARCHITECTURE,
  ARM_LAYER_SUFFIX,
  ARM_LAYERS,
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DEFAULT_LAYER_AWS_ACCOUNT,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LAYER_LOOKUP,
  LayerKey,
  LIST_FUNCTIONS_MAX_RETRY_COUNT,
  MAX_LAMBDA_STATE_CHECK_ATTEMPTS,
  Runtime,
  RUNTIME_LOOKUP,
  SITES,
} from '../constants'
import {FunctionConfiguration, InstrumentationSettings} from '../interfaces'
import {applyLogGroupConfig} from '../loggroup'
import {applyTagConfig} from '../tags'

/**
 * Returns an array of merged layer ARNs if given a Full Layer ARN,
 * if not, it justs returns the layer ARNs provided.
 *
 * @param fullLayerARN a complete layer ARN.
 * @param partialLayerARN a partial layer ARN.
 * @param layerARNs an array of layer ARNs.
 * @returns an array of layer ARNs.
 */
export const addLayerArn = (fullLayerArn: string | undefined, previousLayerName: string, layerARNs: string[]) => {
  if (fullLayerArn) {
    if (!layerARNs.includes(fullLayerArn)) {
      // Remove any other versions of the layer
      layerARNs = [...layerARNs.filter((layer) => !layer.includes(previousLayerName)), fullLayerArn]
    }
  }

  return layerARNs
}

/**
 * Returns a coerced boolean given string booleans or booleans in
 * an spread array. Every other value will be ignored.
 *
 * @param fallback default value if none of the provided `values` comply.
 * @param values an spread array of string booleans or booleans.
 * @returns a coerced boolean.
 */
export const coerceBoolean = (fallback: boolean, ...values: any[]): boolean => {
  for (const value of values) {
    switch (typeof value) {
      case 'boolean':
        return value
      case 'string':
        if (value.toString().toLowerCase() === 'true') {
          return true
        } else if (value.toString().toLowerCase() === 'false') {
          return false
        }
        break

      default:
        continue
    }
  }

  return fallback
}

/**
 * Returns an array of functions grouped by its region, it
 * throws an error if there are functions without a region.
 *
 * @param functions an array of strings comprised by
 * Functions ARNs, Partial ARNs, or Function Names.
 * @param defaultRegion a fallback region
 * @returns an array of functions grouped by region
 */
export const collectFunctionsByRegion = (
  functions: string[],
  defaultRegion: string | undefined
): {[key: string]: string[]} => {
  const groups: {[key: string]: string[]} = {}
  const regionless: string[] = []
  for (const func of functions) {
    const region = getRegion(func) ?? defaultRegion
    if (region === undefined) {
      regionless.push(func)
      continue
    }
    if (groups[region] === undefined) {
      groups[region] = []
    }
    const group = groups[region]
    group.push(func)
  }
  if (regionless.length > 0) {
    throw Error(
      `No default region specified for ${JSON.stringify(regionless)}. Use -r, --region, or use a full functionARN\n`
    )
  }

  return groups
}

/**
 * Given a layer runtime, return its latest version.
 *
 * @param runtime the runtime of the layer.
 * @param region the region where the layer is stored.
 * @returns the latest version of the layer to find.
 */
export const findLatestLayerVersion = async (layer: LayerKey, region: string) => {
  let latestVersion = 0

  let searchStep = latestVersion > 0 ? 1 : 100
  let layerVersion = latestVersion + searchStep
  const account = region.startsWith('us-gov') ? GOVCLOUD_LAYER_AWS_ACCOUNT : DEFAULT_LAYER_AWS_ACCOUNT
  const layerName = LAYER_LOOKUP[layer]
  let foundLatestVersion = false
  const lambda = new Lambda({region})
  while (!foundLatestVersion) {
    try {
      // Search next version
      await lambda
        .getLayerVersion({
          LayerName: `arn:aws:lambda:${region}:${account}:layer:${layerName}`,
          VersionNumber: layerVersion,
        })
        .promise()
      latestVersion = layerVersion
      // Increase layer version
      layerVersion += searchStep
    } catch (e) {
      // Search step is too big, reset target to previous version
      // with a smaller search step
      if (searchStep > 1) {
        layerVersion -= searchStep
        searchStep /= 10
        layerVersion += searchStep
      } else {
        // Search step is 1, current version was not found.
        // It is likely that the last checked is the latest.
        // Check the next version to be certain, since
        // current version could've been deleted by accident.
        try {
          layerVersion += searchStep
          await lambda
            .getLayerVersion({
              LayerName: `arn:aws:lambda:${region}:${account}:layer:${layerName}`,
              VersionNumber: layerVersion,
            })
            .promise()
          latestVersion = layerVersion
          // Continue the search if the next version does exist (unlikely event)
          layerVersion += searchStep
        } catch (e) {
          // The next version doesn't exist either, so the previous version is indeed the latest
          foundLatestVersion = true
        }
      }
    }
  }

  return latestVersion
}

export const isMissingAWSCredentials = () =>
  // If env vars and aws_sdk_config.credentials are not set return true otherwise return false
  (process.env[AWS_ACCESS_KEY_ID_ENV_VAR] === undefined || process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] === undefined) &&
  !aws_sdk_config.credentials
export const isMissingDatadogSiteEnvVar = () => {
  const site = process.env[CI_SITE_ENV_VAR]
  if (site !== undefined) {
    return !SITES.includes(site)
  }

  return true
}

export const isMissingAnyDatadogApiKeyEnvVar = () =>
  !(
    process.env[CI_API_KEY_ENV_VAR] ||
    process.env[CI_KMS_API_KEY_ENV_VAR] ||
    process.env[CI_API_KEY_SECRET_ARN_ENV_VAR]
  )
export const isMissingDatadogEnvVars = () => isMissingDatadogSiteEnvVar() || isMissingAnyDatadogApiKeyEnvVar()

export const getAllLambdaFunctionConfigs = async (lambda: Lambda) => getLambdaFunctionConfigsFromRegex(lambda, '.')

// Returns false if not all runtimes are of the same RuntimeType across multiple functions
export const checkRuntimeTypesAreUniform = (configList: FunctionConfiguration[]) =>
  configList
    .map((item) => item.lambdaConfig.Runtime)
    .every(
      (runtime) =>
        RUNTIME_LOOKUP[runtime! as Runtime] === RUNTIME_LOOKUP[configList[0].lambdaConfig.Runtime! as Runtime]
    )
/**
 * Given a Lambda instance and a regular expression,
 * returns all the Function Configurations that match.
 *
 * @param lambda an instance of Lambda from aws-sdk.
 * @param pattern a regular expression
 * @returns an array of Lambda FunctionConfiguration's that match the pattern above.
 */
export const getLambdaFunctionConfigsFromRegex = async (
  lambda: Lambda,
  pattern: string
): Promise<Lambda.FunctionConfiguration[]> => {
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
        throw Error(`Max retry count exceeded. ${e}`)
      }
    }
  }

  return matchedFunctions
}

/**
 * Given a Lambda instance and an array of Lambda names,
 * return all the Lambda Function Configurations.
 *
 * @param lambda an instance of Lambda from aws-sdk.
 * @param functionARNs an array of strings comprised by
 * Functions ARNs, Partial ARNs, or Function Names.
 * @returns an array of Lambda FunctionConfiguration's.
 */
export const getLambdaFunctionConfigs = (
  lambda: Lambda,
  functionARNs: string[]
): Promise<Lambda.FunctionConfiguration[]> => {
  const promises = functionARNs.map((fn) => getLambdaFunctionConfig(lambda, fn))

  return Promise.all(promises)
}

/**
 * Returns the correct ARN of a **Specific Runtime Layer** given its configuration, region,
 * and settings (optional).
 *
 * @param config a Lambda FunctionConfiguration.
 * @param region a region where the layer is hosted.
 * @param settings instrumentation settings, mainly used to change the AWS account that contains the Layer.
 * @returns the ARN of a **Specific Runtime Layer** with the correct region, account, architecture, and name.
 */
export const getLayerArn = (
  config: Lambda.FunctionConfiguration,
  layer: LayerKey,
  region: string,
  settings?: InstrumentationSettings
) => {
  let layerName = LAYER_LOOKUP[layer]
  if (ARM_LAYERS.includes(layer) && config.Architectures?.includes(ARM64_ARCHITECTURE)) {
    layerName += ARM_LAYER_SUFFIX
  }
  const account = settings?.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region.startsWith('us-gov')
  if (isGovCloud) {
    return `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerName}`
  }

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

export const getLayerNameWithVersion = (layerArn: string): string | undefined => {
  const [, , , , , , name, version] = layerArn.split(':')

  return name && version ? `${name}:${version}` : undefined
}

export const getLayers = (config: Lambda.FunctionConfiguration) => (config.Layers ?? []).map((layer) => layer.Arn!)

/**
 * Call the aws-sdk Lambda api to get a Function given
 * an ARN and then return its Configuration.
 *
 * @param lambda an instance of Lambda from aws-sdk.
 * @param functionARN a string, can be Function ARN, Partial ARN, or a Function Name.
 * @returns the Lambda FunctionConfiguration of the given ARN.
 */
export const getLambdaFunctionConfig = async (
  lambda: Lambda,
  functionARN: string
): Promise<Lambda.FunctionConfiguration> => {
  const params: GetFunctionRequest = {
    FunctionName: functionARN,
  }
  const result = await lambda.getFunction(params).promise()
  // AWS typescript API is slightly mistyped, adds undefineds where
  // there shouldn't be.
  const config = result.Configuration!

  return config
}

/**
 * Given a Function ARN, return its region by splitting the string,
 * can return undefined if it is doesn't exist.
 *
 * @param functionARN a string, can be Function ARN, Partial ARN, or a Function Name.
 * @returns the region of an ARN.
 */
export const getRegion = (functionARN: string): string | undefined => {
  const [, , , region] = functionARN.split(':')

  return region === undefined || region === '*' ? undefined : region
}

/**
 * Returns whether a Lambda Function is active or throws an error if
 * the FunctionConfiguration does not comply with `Successful` or `Active`.
 *
 * @param lambda an instance of Lambda from aws-sdk.
 * @param config a Lambda FunctionConfiguration.
 * @param functionArn a string, can be Function ARN, Partial ARN, or a Function Name.
 * @param attempts the number of attemps that have passed since the last retry.
 * @returns if a Lambda Function is active.
 */
export const isLambdaActive = async (
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
  if (config.State === 'Pending' && attempts <= MAX_LAMBDA_STATE_CHECK_ATTEMPTS) {
    await wait(2 ** attempts * 1000)
    const refetchedConfig = await getLambdaFunctionConfig(lambda, functionArn)

    return isLambdaActive(lambda, refetchedConfig, functionArn, (attempts += 1))
  }
  throw Error(
    `Can't instrument ${functionArn}, as current State is ${config.State} (must be "Active") and Last Update Status is ${config.LastUpdateStatus} (must be "Successful")`
  )
}

/**
 * Returns whether the runtime given is supported by the Datadog CI Lambda.
 *
 * @param runtime a string representing a Lambda FunctionConfiguration Runtime.
 * @returns if a runtime is supported.
 */
export const isSupportedRuntime = (runtime?: string): runtime is Runtime =>
  runtime !== undefined && RUNTIME_LOOKUP[runtime as Runtime] !== undefined

export const isLayerRuntime = (runtime: string): runtime is LayerKey => LAYER_LOOKUP[runtime as LayerKey] !== undefined

export const sentenceMatchesRegEx = (sentence: string, regex: RegExp) => sentence.match(regex)

export const updateLambdaFunctionConfigs = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  configs: FunctionConfiguration[]
) => {
  const results = configs.map(async (c) => {
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

export const willUpdateFunctionConfigs = (configs: FunctionConfiguration[]) => {
  let willUpdate = false
  for (const config of configs) {
    if (
      config.updateRequest !== undefined ||
      config.logGroupConfiguration?.createLogGroupRequest !== undefined ||
      config.logGroupConfiguration?.deleteSubscriptionFilterRequest !== undefined ||
      config.logGroupConfiguration?.subscriptionFilterRequest !== undefined ||
      config?.tagConfiguration !== undefined
    ) {
      willUpdate = true

      break
    }
  }

  return willUpdate
}

/**
 * Waits for n ms
 *
 * @param ms
 */
const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))
