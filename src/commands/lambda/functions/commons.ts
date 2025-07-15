import {Writable} from 'stream'

import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {
  LambdaClient,
  FunctionConfiguration as LFunctionConfiguration,
  GetFunctionCommandInput,
  ListFunctionsCommandOutput,
  GetLayerVersionCommand,
  ListFunctionsCommand,
  GetFunctionCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommandInput,
  Runtime,
} from '@aws-sdk/client-lambda'
import {FromIniInit} from '@aws-sdk/credential-provider-ini'
import {fromIni, fromNodeProviderChain} from '@aws-sdk/credential-providers'
import {AwsCredentialIdentity, AwsCredentialIdentityProvider} from '@aws-sdk/types'
import {CredentialsProviderError} from '@smithy/property-provider'
import inquirer from 'inquirer'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR, CI_SITE_ENV_VAR} from '../../../constants'
import * as helpersRenderer from '../../../helpers/renderer'
import {maskString} from '../../../helpers/utils'
import {isValidDatadogSite} from '../../../helpers/validation'

import {
  ARM64_ARCHITECTURE,
  ARM_LAYERS,
  ARM_LAYER_SUFFIX,
  AWS_SHARED_CREDENTIALS_FILE_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  DEFAULT_LAYER_AWS_ACCOUNT,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LayerKey,
  LAYER_LOOKUP,
  EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
  RUNTIME_LOOKUP,
  SKIP_MASKING_LAMBDA_ENV_VARS,
} from '../constants'
import {FunctionConfiguration, InstrumentationSettings, InstrumentedConfigurationGroup} from '../interfaces'
import {applyLogGroupConfig} from '../loggroup'
import {awsProfileQuestion} from '../prompt'
import * as instrumentRenderer from '../renderers/instrument-uninstrument-renderer'
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
export const addLayerArn = (
  fullLayerArn: string | undefined,
  previousLayerName: string,
  layerARNs: string[]
): string[] => {
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
export const findLatestLayerVersion = async (layer: LayerKey, region: string): Promise<number> => {
  let latestVersion = 0

  let searchStep = latestVersion > 0 ? 1 : 100
  let layerVersion = latestVersion + searchStep
  const account = region.startsWith('us-gov') ? GOVCLOUD_LAYER_AWS_ACCOUNT : DEFAULT_LAYER_AWS_ACCOUNT
  const layerName = LAYER_LOOKUP[layer]
  let foundLatestVersion = false
  const lambdaClient = new LambdaClient({region, retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY})
  while (!foundLatestVersion) {
    try {
      // Search next version
      const command = new GetLayerVersionCommand({
        LayerName: `arn:aws:lambda:${region}:${account}:layer:${layerName}`,
        VersionNumber: layerVersion,
      })
      await lambdaClient.send(command)
      latestVersion = layerVersion
      // Increase layer version
      layerVersion += searchStep
    } catch {
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
          const command = new GetLayerVersionCommand({
            LayerName: `arn:aws:lambda:${region}:${account}:layer:${layerName}`,
            VersionNumber: layerVersion,
          })
          await lambdaClient.send(command)

          latestVersion = layerVersion
          // Continue the search if the next version does exist (unlikely event)
          layerVersion += searchStep
        } catch {
          // The next version doesn't exist either, so the previous version is indeed the latest
          foundLatestVersion = true
        }
      }
    }
  }

  return latestVersion
}

export const getAWSFileCredentialsParams = (profile: string): FromIniInit => {
  const init: FromIniInit = {profile}

  if (process.env[AWS_SHARED_CREDENTIALS_FILE_ENV_VAR] !== undefined) {
    init.filepath = process.env[AWS_SHARED_CREDENTIALS_FILE_ENV_VAR]
  }

  // If provided profile is enforced by MFA and a session
  // token is not set we must request for the MFA token.
  init.mfaCodeProvider = async (mfaSerial) => {
    const answer = await inquirer.prompt(awsProfileQuestion(mfaSerial))

    return answer.AWS_MFA
  }

  return init
}

/**
 * Returns the loaded AWS Credentials from the given profile.
 *
 * Note: the AWS SDK loads credentials automatically in
 * node environments.
 *
 * @param {string} profile the AWS Credentials profile
 * @returns {AwsCredentialIdentity} credentials object.
 */
export const getAWSProfileCredentials = async (profile: string): Promise<AwsCredentialIdentity | undefined> => {
  const init = getAWSFileCredentialsParams(profile)

  try {
    const credentialsProvider: AwsCredentialIdentityProvider = fromIni(init)
    const credentials: AwsCredentialIdentity = await credentialsProvider()

    return credentials
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't set AWS profile credentials. ${err.message}`)
    }
  }
}

export const getAWSCredentials = async (): Promise<AwsCredentialIdentity | undefined> => {
  const provider = fromNodeProviderChain()

  try {
    const credentials = await provider()

    return credentials
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === CredentialsProviderError.name) {
        return undefined
      }
      throw Error(`Couldn't fetch AWS credentials. ${err.message}`)
    }
  }
}

export const isMissingAnyDatadogApiKeyEnvVar = (): boolean =>
  !(
    process.env[CI_API_KEY_ENV_VAR] ||
    process.env[API_KEY_ENV_VAR] ||
    process.env[CI_KMS_API_KEY_ENV_VAR] ||
    process.env[CI_API_KEY_SECRET_ARN_ENV_VAR]
  )
export const isMissingDatadogEnvVars = (): boolean =>
  !isValidDatadogSite(process.env[CI_SITE_ENV_VAR]) || isMissingAnyDatadogApiKeyEnvVar()

export const getAllLambdaFunctionConfigs = async (lambdaClient: LambdaClient): Promise<LFunctionConfiguration[]> =>
  getLambdaFunctionConfigsFromRegex(lambdaClient, '.')

// Returns false if not all runtimes are of the same RuntimeType across multiple functions
export const checkRuntimeTypesAreUniform = (configList: FunctionConfiguration[]): boolean =>
  configList
    .map((item) => item.lambdaConfig.Runtime)
    .every((runtime) => RUNTIME_LOOKUP[runtime!] === RUNTIME_LOOKUP[configList[0].lambdaConfig.Runtime!])

/**
 * Given a Lambda instance and a regular expression,
 * returns all the Function Configurations that match.
 *
 * @param lambda an instance of Lambda from aws-sdk.
 * @param pattern a regular expression
 * @returns an array of Lambda FunctionConfiguration's that match the pattern above.
 */
export const getLambdaFunctionConfigsFromRegex = async (
  lambdaClient: LambdaClient,
  pattern: string
): Promise<LFunctionConfiguration[]> => {
  const regEx = new RegExp(pattern)
  const matchedFunctions: LFunctionConfiguration[] = []
  let response: ListFunctionsCommandOutput
  let nextMarker: string | undefined

  while (true) {
    const command = new ListFunctionsCommand({Marker: nextMarker})
    response = await lambdaClient.send(command)
    response.Functions?.map((fn) => fn.FunctionName?.match(regEx) && matchedFunctions.push(fn))
    nextMarker = response.NextMarker
    if (!nextMarker) {
      break
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
  lambdaClient: LambdaClient,
  functionARNs: string[]
): Promise<LFunctionConfiguration[]> => {
  const promises = functionARNs.map((fn) => getLambdaFunctionConfig(lambdaClient, fn))

  return Promise.all(promises)
}

/**
 * Returns the correct ARN of a **Specific Runtime Layer** given its configuration, region,
 * and settings (optional).
 *
 * @param config a Lambda FunctionConfiguration.
 * @param layer a Lambda layer.
 * @param region a region where the layer is hosted.
 * @param settings instrumentation settings, mainly used to change the AWS account that contains the Layer.
 * @returns the ARN of a **Specific Runtime Layer** with the correct region, account, architecture, and name.
 */
export const getLayerArn = (
  config: LFunctionConfiguration,
  layer: LayerKey,
  region: string,
  settings?: InstrumentationSettings
): string => {
  let layerNameSuffix = LAYER_LOOKUP[layer]
  if (ARM_LAYERS.includes(layer) && config.Architectures?.includes(ARM64_ARCHITECTURE)) {
    layerNameSuffix += ARM_LAYER_SUFFIX
  }
  if (settings?.lambdaFips) {
    layerNameSuffix += '-FIPS'
  }
  const account = settings?.layerAWSAccount ?? DEFAULT_LAYER_AWS_ACCOUNT
  const isGovCloud = region.startsWith('us-gov')
  let arnBuilt
  if (isGovCloud) {
    arnBuilt = `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:${layerNameSuffix}`
  } else {
    arnBuilt = `arn:aws:lambda:${region}:${account}:layer:${layerNameSuffix}`
  }

  return arnBuilt
}

export const getLayerNameWithVersion = (layerArn: string): string | undefined => {
  const [, , , , , , name, version] = layerArn.split(':')

  return name && version ? `${name}:${version}` : undefined
}

export const getLayers = (config: LFunctionConfiguration): string[] => (config.Layers ?? []).map((layer) => layer.Arn!)

/**
 * Call the aws-sdk Lambda api to get a Function given
 * an ARN and then return its Configuration.
 *
 * @param lambdaClient an instance of LambdaClient.
 * @param functionARN a string, can be Function ARN, Partial ARN, or a Function Name.
 * @returns the Lambda FunctionConfiguration of the given ARN.
 */
export const getLambdaFunctionConfig = async (
  lambdaClient: LambdaClient,
  functionARN: string
): Promise<LFunctionConfiguration> => {
  const params: GetFunctionCommandInput = {
    FunctionName: functionARN,
  }
  const command = new GetFunctionCommand(params)
  const response = await lambdaClient.send(command)
  // AWS typescript API is slightly mistyped, adds undefineds where
  // there shouldn't be.
  const config = response.Configuration!

  return config
}

/**
 * Given a Function ARN, return its region by splitting the string,
 * can return undefined if it doesn't exist.
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
export const isSupportedRuntime = (runtime?: string): runtime is Runtime =>
  runtime !== undefined && RUNTIME_LOOKUP[runtime as Runtime] !== undefined

export const isLayerRuntime = (runtime: string): runtime is LayerKey => LAYER_LOOKUP[runtime as LayerKey] !== undefined

export const sentenceMatchesRegEx = (sentence: string, regex: RegExp) => sentence.match(regex)

export const updateLambdaFunctionConfig = async (
  lambdaClient: LambdaClient,
  cloudWatchLogsClient: CloudWatchLogsClient,
  config: FunctionConfiguration
): Promise<void> => {
  if (config.updateFunctionConfigurationCommandInput !== undefined) {
    await updateFunctionConfiguration(lambdaClient, config.updateFunctionConfigurationCommandInput)
  }
  if (config.logGroupConfiguration !== undefined) {
    await applyLogGroupConfig(cloudWatchLogsClient, config.logGroupConfiguration)
  }
  if (config.tagConfiguration !== undefined) {
    await applyTagConfig(lambdaClient, config.tagConfiguration)
  }
}

export const updateFunctionConfiguration = async (
  client: LambdaClient,
  input: UpdateFunctionConfigurationCommandInput
): Promise<void> => {
  const command = new UpdateFunctionConfigurationCommand(input)
  await client.send(command)
}

export const handleLambdaFunctionUpdates = async (
  configGroups: InstrumentedConfigurationGroup[],
  stdout: Writable
): Promise<void> => {
  let totalFunctions = 0
  let totalFailedUpdates = 0
  for (const group of configGroups) {
    const spinner = instrumentRenderer.updatingFunctionsConfigFromRegionSpinner(group.region, group.configs.length)
    spinner.start()
    const failedUpdates = []
    for (const config of group.configs) {
      totalFunctions += 1
      try {
        await updateLambdaFunctionConfig(group.lambdaClient, group.cloudWatchLogsClient, config)
      } catch (err) {
        failedUpdates.push({functionARN: config.functionARN, error: err})
        totalFailedUpdates += 1
      }
    }

    if (failedUpdates.length === group.configs.length) {
      spinner.fail(instrumentRenderer.renderFailedUpdatingEveryLambdaFunctionFromRegion(group.region))
    } else if (failedUpdates.length > 0) {
      spinner.warn(
        instrumentRenderer.renderUpdatedLambdaFunctionsFromRegion(
          group.region,
          group.configs.length - failedUpdates.length
        )
      )
    }

    for (const failedUpdate of failedUpdates) {
      stdout.write(instrumentRenderer.renderFailedUpdatingLambdaFunction(failedUpdate.functionARN, failedUpdate.error))
    }

    if (failedUpdates.length === 0) {
      spinner.succeed(instrumentRenderer.renderUpdatedLambdaFunctionsFromRegion(group.region, group.configs.length))
    }
  }

  if (totalFunctions === totalFailedUpdates) {
    stdout.write(instrumentRenderer.renderFail(instrumentRenderer.renderFailedUpdatingEveryLambdaFunction()))

    throw Error()
  }

  if (totalFailedUpdates > 0) {
    stdout.write(
      helpersRenderer.renderSoftWarning(
        instrumentRenderer.renderUpdatedLambdaFunctions(totalFunctions - totalFailedUpdates)
      )
    )
  }

  if (!totalFailedUpdates) {
    stdout.write(instrumentRenderer.renderSuccess(instrumentRenderer.renderUpdatedLambdaFunctions(totalFunctions)))
  }
}

export const willUpdateFunctionConfigs = (configs: FunctionConfiguration[]): boolean => {
  let willUpdate = false
  for (const config of configs) {
    if (
      config.updateFunctionConfigurationCommandInput !== undefined ||
      config.logGroupConfiguration?.createLogGroupCommandInput !== undefined ||
      config.logGroupConfiguration?.deleteSubscriptionFilterCommandInput !== undefined ||
      config.logGroupConfiguration?.putSubscriptionFilterCommandInput !== undefined ||
      config?.tagConfiguration !== undefined
    ) {
      willUpdate = true

      break
    }
  }

  return willUpdate
}

/**
 * Masks environment variables in a Lambda function configuration.
 * Makes a copy as to not modify the config in place.
 * @param config
 * @returns masked config
 */
export const maskConfig = (config: any): any => {
  // We stringify and parse again to make a deep copy
  const configCopy = JSON.parse(JSON.stringify(config))
  const vars = configCopy.Environment?.Variables
  if (!vars) {
    return configCopy
  }

  for (const key in vars) {
    if (!SKIP_MASKING_LAMBDA_ENV_VARS.has(key)) {
      vars[key] = maskString(vars[key])
    }
  }

  return configCopy
}
