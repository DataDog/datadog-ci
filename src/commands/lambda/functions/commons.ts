import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {GetFunctionRequest} from 'aws-sdk/clients/lambda'
import {
  ARM64_ARCHITECTURE,
  ARM_LAYER_SUFFIX,
  ARM_RUNTIMES,
  DEFAULT_LAYER_AWS_ACCOUNT,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LIST_FUNCTIONS_MAX_RETRY_COUNT,
  Runtime,
  RUNTIME_LAYER_LOOKUP,
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
        throw Error('Max retry count exceeded.')
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
  runtime: Runtime,
  region: string,
  settings?: InstrumentationSettings
) => {
  let layerName = RUNTIME_LAYER_LOOKUP[runtime]
  if (ARM_RUNTIMES.includes(runtime) && config.Architectures?.includes(ARM64_ARCHITECTURE)) {
    layerName += ARM_LAYER_SUFFIX
  }
  const account = settings?.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region.startsWith('us-gov')
  if (isGovCloud) {
    return `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerName}`
  }

  return `arn:aws:lambda:${region}:${account}:layer:${layerName}`
}

export const getLayers = (config: Lambda.FunctionConfiguration) => (config.Layers ?? []).map((layer) => layer.Arn ?? '')

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
 * Returns whether the runtime given is supported by the Datadog CI Lambda.
 *
 * @param runtime a string representing a Lambda FunctionConfiguration Runtime.
 * @returns if a runtime is supported.
 */
export const isSupportedRuntime = (runtime?: string): runtime is Runtime => {
  const lookup = RUNTIME_LAYER_LOOKUP as Record<string, string>

  return runtime !== undefined && lookup[runtime] !== undefined
}

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
