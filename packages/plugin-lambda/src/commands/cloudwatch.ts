import {Writable} from 'stream'

import {IAMClient} from '@aws-sdk/client-iam'
import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import {LambdaCloudwatchCommand} from '@datadog/datadog-ci-base/commands/lambda/cloudwatch'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import * as helperRenderer from '@datadog/datadog-ci-base/helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'

import {AWS_DEFAULT_REGION_ENV_VAR, EXPONENTIAL_BACKOFF_RETRY_STRATEGY} from '../constants'
import {disableCloudwatchLogs, enableCloudwatchLogs, getFunctionDetails} from '../functions/cloudwatch'
import {
  collectFunctionsByRegion,
  getAWSProfileCredentials,
  getLambdaFunctionConfigsFromRegex,
} from '../functions/commons'
import {LambdaConfigOptions} from '../interfaces'
import * as cloudwatchRenderer from '../renderers/cloudwatch-renderer'
import * as commonRenderer from '../renderers/common-renderer'

type CloudwatchAction = (iamClient: IAMClient, roleName: string, functionName: string) => Promise<void>

interface CloudwatchCommandOptions {
  action: 'enable' | 'disable'
  cloudwatchAction: CloudwatchAction
  stdout: Writable
  functions: string[]
  region: string | undefined
  regExPattern: string | undefined
  dryRun: boolean
  profile: string | undefined
  configPath: string | undefined
  fips: boolean
  fipsIgnoreError: boolean
}

const processRegion = async (
  opts: CloudwatchCommandOptions,
  region: string,
  functionARNs: string[],
  lambdaClient: LambdaClient,
  iamClient: IAMClient
): Promise<0 | 1> => {
  let hasError = false
  if (opts.dryRun) {
    for (const fn of functionARNs) {
      try {
        const {roleName} = await getFunctionDetails(lambdaClient, fn)
        opts.stdout.write(cloudwatchRenderer.renderDryRunFunctionAction(opts.action, fn, roleName))
      } catch (err) {
        hasError = true
        opts.stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
      }
    }

    return hasError ? 1 : 0
  }

  const spinner = cloudwatchRenderer.processingFunctionsSpinner(region, functionARNs.length)
  spinner.start()

  for (const fn of functionARNs) {
    try {
      const {roleName, functionName} = await getFunctionDetails(lambdaClient, fn)
      await opts.cloudwatchAction(iamClient, roleName, functionName)
      opts.stdout.write(cloudwatchRenderer.renderFunctionSuccess(opts.action, fn, roleName))
    } catch (err) {
      hasError = true
      opts.stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
    }
  }

  if (hasError) {
    spinner.fail(cloudwatchRenderer.renderFailedProcessingFunctions(region))

    return 1
  }

  spinner.succeed(cloudwatchRenderer.renderProcessedFunctions(region, functionARNs.length))

  return 0
}

const executeCloudwatchCommand = async (opts: CloudwatchCommandOptions): Promise<0 | 1> => {
  const fipsEnabled = opts.fips || (toBoolean(process.env[FIPS_ENV_VAR]) ?? false)
  const fipsIgnoreError = opts.fipsIgnoreError || (toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false)
  enableFips(fipsEnabled, fipsIgnoreError)

  opts.stdout.write(cloudwatchRenderer.renderCloudwatchHeader(opts.action, opts.dryRun))

  const config: LambdaConfigOptions = {
    functions: [],
    region: process.env[AWS_DEFAULT_REGION_ENV_VAR],
  }
  const lambdaConfig = {lambda: config}
  const resolvedConfig = (
    await resolveConfigFromFile(lambdaConfig, {configPath: opts.configPath, defaultConfigPaths: DEFAULT_CONFIG_PATHS})
  ).lambda

  const profile = opts.profile ?? resolvedConfig.profile
  let credentials: AwsCredentialIdentity | undefined
  if (profile) {
    try {
      credentials = await getAWSProfileCredentials(profile)
    } catch (err) {
      opts.stdout.write(helperRenderer.renderError(err))

      return 1
    }
  }

  const hasSpecifiedFunctions = opts.functions.length !== 0 || resolvedConfig.functions.length !== 0
  const hasSpecifiedRegExPattern = opts.regExPattern !== undefined && opts.regExPattern !== ''
  if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
    opts.stdout.write(cloudwatchRenderer.renderNoFunctionsSpecifiedError())

    return 1
  }

  if (hasSpecifiedRegExPattern) {
    if (hasSpecifiedFunctions) {
      opts.stdout.write(commonRenderer.renderFunctionsAndFunctionsRegexOptionsBothSetError(opts.functions.length !== 0))

      return 1
    }
    if (opts.regExPattern!.includes(':')) {
      opts.stdout.write(commonRenderer.renderRegexSetWithARNError())

      return 1
    }

    const region = opts.region || resolvedConfig.region
    if (!region) {
      opts.stdout.write(commonRenderer.renderNoDefaultRegionSpecifiedError())

      return 1
    }

    const lambdaClientConfig: LambdaClientConfig = {
      region,
      credentials,
      retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    const iamClient = new IAMClient({
      region,
      credentials,
      retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
    })

    try {
      const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambdaClient, opts.regExPattern!)
      const functionARNs = matchedFunctions.map((fn) => fn.FunctionArn!).filter(Boolean)

      return processRegion(opts, region, functionARNs, lambdaClient, iamClient)
    } catch (err) {
      opts.stdout.write(helperRenderer.renderError(`Couldn't fetch Lambda functions. ${err}`))

      return 1
    }
  }

  let functionGroups
  try {
    functionGroups = collectFunctionsByRegion(
      opts.functions.length !== 0 ? opts.functions : resolvedConfig.functions,
      opts.region || resolvedConfig.region
    )
  } catch (err) {
    opts.stdout.write(commonRenderer.renderCouldntGroupFunctionsError(err))

    return 1
  }

  let hasError = false
  for (const [region, functionARNs] of Object.entries(functionGroups)) {
    const lambdaClientConfig: LambdaClientConfig = {
      region,
      credentials,
      retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    const iamClient = new IAMClient({
      region,
      credentials,
      retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
    })

    const result = await processRegion(opts, region, functionARNs, lambdaClient, iamClient)
    if (result === 1) {
      hasError = true
    }
  }

  return hasError ? 1 : 0
}

export class PluginCommand extends LambdaCloudwatchCommand {
  public async execute(): Promise<0 | 1> {
    const cloudwatchAction: CloudwatchAction = this.action === 'enable' ? enableCloudwatchLogs : disableCloudwatchLogs

    return executeCloudwatchCommand({
      action: this.action,
      cloudwatchAction,
      stdout: this.context.stdout,
      functions: this.functions,
      region: this.region,
      regExPattern: this.regExPattern,
      dryRun: this.dryRun,
      profile: this.profile,
      configPath: this.configPath,
      fips: this.fips,
      fipsIgnoreError: this.fipsIgnoreError,
    })
  }
}
