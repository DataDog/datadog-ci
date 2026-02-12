import {IAMClient} from '@aws-sdk/client-iam'
import {LambdaClient} from '@aws-sdk/client-lambda'
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

export class PluginCommand extends LambdaCloudwatchCommand {
  private get cloudwatchAction(): CloudwatchAction {
    return this.action === 'enable' ? enableCloudwatchLogs : disableCloudwatchLogs
  }

  public async execute(): Promise<0 | 1> {
    const fipsEnabled = this.fips || (toBoolean(process.env[FIPS_ENV_VAR]) ?? false)
    const fipsIgnoreError = this.fipsIgnoreError || (toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false)
    enableFips(fipsEnabled, fipsIgnoreError)

    const stdout = this.context.stdout
    stdout.write(cloudwatchRenderer.renderCloudwatchHeader(this.action, this.dryRun))

    const config: LambdaConfigOptions = {
      functions: [],
      region: process.env[AWS_DEFAULT_REGION_ENV_VAR],
    }
    const lambdaConfig = {lambda: config}
    const resolvedConfig = (
      await resolveConfigFromFile(lambdaConfig, {
        configPath: this.configPath,
        defaultConfigPaths: DEFAULT_CONFIG_PATHS,
      })
    ).lambda

    const profile = this.profile ?? resolvedConfig.profile
    let credentials: AwsCredentialIdentity | undefined
    if (profile) {
      try {
        credentials = await getAWSProfileCredentials(profile)
      } catch (err) {
        stdout.write(helperRenderer.renderError(err))

        return 1
      }
    }

    const hasSpecifiedFunctions = this.functions.length !== 0 || resolvedConfig.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      stdout.write(cloudwatchRenderer.renderNoFunctionsSpecifiedError())

      return 1
    }

    if (hasSpecifiedRegExPattern) {
      if (hasSpecifiedFunctions) {
        stdout.write(commonRenderer.renderFunctionsAndFunctionsRegexOptionsBothSetError(this.functions.length !== 0))

        return 1
      }
      if (this.regExPattern!.includes(':')) {
        stdout.write(commonRenderer.renderRegexSetWithARNError())

        return 1
      }

      const region = this.region || resolvedConfig.region
      if (!region) {
        stdout.write(commonRenderer.renderNoDefaultRegionSpecifiedError())

        return 1
      }

      const lambdaClient = new LambdaClient({
        region,
        credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      })
      const iamClient = new IAMClient({
        region,
        credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      })

      try {
        const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambdaClient, this.regExPattern!)
        const functionARNs = matchedFunctions.map((fn) => fn.FunctionArn!).filter(Boolean)

        return this.processRegion(functionARNs, lambdaClient, iamClient)
      } catch (err) {
        stdout.write(helperRenderer.renderError(`Couldn't fetch Lambda functions. ${err}`))

        return 1
      }
    }

    let functionGroups
    try {
      functionGroups = collectFunctionsByRegion(
        this.functions.length !== 0 ? this.functions : resolvedConfig.functions,
        this.region || resolvedConfig.region
      )
    } catch (err) {
      stdout.write(commonRenderer.renderCouldntGroupFunctionsError(err))

      return 1
    }

    const results = await Promise.all(
      Object.entries(functionGroups).map(([region, functionARNs]) => {
        const lambdaClient = new LambdaClient({
          region,
          credentials,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        })
        const iamClient = new IAMClient({
          region,
          credentials,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        })

        return this.processRegion(functionARNs, lambdaClient, iamClient)
      })
    )

    return results.some((r) => r === 1) ? 1 : 0
  }

  private async processRegion(
    functionARNs: string[],
    lambdaClient: LambdaClient,
    iamClient: IAMClient
  ): Promise<0 | 1> {
    const stdout = this.context.stdout
    let hasError = false

    if (this.dryRun) {
      for (const fn of functionARNs) {
        try {
          const {roleName} = await getFunctionDetails(lambdaClient, fn)
          stdout.write(cloudwatchRenderer.renderDryRunFunctionAction(this.action, fn, roleName))
        } catch (err) {
          hasError = true
          stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
        }
      }

      return hasError ? 1 : 0
    }

    for (const fn of functionARNs) {
      try {
        const {roleName, functionName} = await getFunctionDetails(lambdaClient, fn)
        await this.cloudwatchAction(iamClient, roleName, functionName)
        stdout.write(cloudwatchRenderer.renderFunctionSuccess(this.action, fn, roleName))
      } catch (err) {
        hasError = true
        stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
      }
    }

    return hasError ? 1 : 0
  }
}
