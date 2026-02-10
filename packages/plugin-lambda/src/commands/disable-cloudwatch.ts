import {IAMClient} from '@aws-sdk/client-iam'
import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import {LambdaDisableCloudwatchCommand} from '@datadog/datadog-ci-base/commands/lambda/disable-cloudwatch'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import * as helperRenderer from '@datadog/datadog-ci-base/helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'

import {AWS_DEFAULT_REGION_ENV_VAR, EXPONENTIAL_BACKOFF_RETRY_STRATEGY} from '../constants'
import {disableCloudwatchLogs, getRoleName} from '../functions/cloudwatch'
import {
  collectFunctionsByRegion,
  getAWSProfileCredentials,
  getLambdaFunctionConfigsFromRegex,
} from '../functions/commons'
import * as cloudwatchRenderer from '../renderers/cloudwatch-renderer'
import * as commonRenderer from '../renderers/common-renderer'

export class PluginCommand extends LambdaDisableCloudwatchCommand {
  private config: any = {
    functions: [],
    region: process.env[AWS_DEFAULT_REGION_ENV_VAR],
  }

  private credentials?: AwsCredentialIdentity

  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.context.stdout.write(cloudwatchRenderer.renderCloudwatchHeader('disable', this.dryRun))

    const lambdaConfig = {lambda: this.config}
    this.config = (
      await resolveConfigFromFile(lambdaConfig, {configPath: this.configPath, defaultConfigPaths: DEFAULT_CONFIG_PATHS})
    ).lambda

    const profile = this.profile ?? this.config.profile
    if (profile) {
      try {
        this.credentials = await getAWSProfileCredentials(profile)
      } catch (err) {
        this.context.stdout.write(helperRenderer.renderError(err))

        return 1
      }
    }

    const hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write(cloudwatchRenderer.renderNoFunctionsSpecifiedError())

      return 1
    }

    if (hasSpecifiedRegExPattern) {
      if (hasSpecifiedFunctions) {
        this.context.stdout.write(
          commonRenderer.renderFunctionsAndFunctionsRegexOptionsBothSetError(this.functions.length !== 0)
        )

        return 1
      }
      if (this.regExPattern!.match(':')) {
        this.context.stdout.write(commonRenderer.renderRegexSetWithARNError())

        return 1
      }

      const region = this.region || this.config.region
      if (!region) {
        this.context.stdout.write(commonRenderer.renderNoDefaultRegionSpecifiedError())

        return 1
      }

      const lambdaClientConfig: LambdaClientConfig = {
        region,
        credentials: this.credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      }
      const lambdaClient = new LambdaClient(lambdaClientConfig)
      const iamClient = new IAMClient({
        region,
        credentials: this.credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      })

      try {
        const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambdaClient, this.regExPattern!)
        const functionARNs = matchedFunctions.map((fn) => fn.FunctionArn!).filter(Boolean)

        return this.processRegion(region, functionARNs, lambdaClient, iamClient)
      } catch (err) {
        this.context.stdout.write(helperRenderer.renderError(`Couldn't fetch Lambda functions. ${err}`))

        return 1
      }
    }

    let functionGroups
    try {
      functionGroups = collectFunctionsByRegion(
        this.functions.length !== 0 ? this.functions : this.config.functions,
        this.region || this.config.region
      )
    } catch (err) {
      this.context.stdout.write(commonRenderer.renderCouldntGroupFunctionsError(err))

      return 1
    }

    let hasError = false
    for (const [region, functionARNs] of Object.entries(functionGroups)) {
      const lambdaClientConfig: LambdaClientConfig = {
        region,
        credentials: this.credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      }
      const lambdaClient = new LambdaClient(lambdaClientConfig)
      const iamClient = new IAMClient({
        region,
        credentials: this.credentials,
        retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
      })

      const result = await this.processRegion(region, functionARNs, lambdaClient, iamClient)
      if (result === 1) {
        hasError = true
      }
    }

    return hasError ? 1 : 0
  }

  private async processRegion(
    region: string,
    functionARNs: string[],
    lambdaClient: LambdaClient,
    iamClient: IAMClient
  ): Promise<0 | 1> {
    if (this.dryRun) {
      for (const fn of functionARNs) {
        try {
          const roleName = await getRoleName(lambdaClient, fn)
          this.context.stdout.write(cloudwatchRenderer.renderDryRunFunctionAction('disable', fn, roleName))
        } catch (err) {
          this.context.stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
        }
      }

      return 0
    }

    const spinner = cloudwatchRenderer.processingFunctionsSpinner(region, functionARNs.length)
    spinner.start()

    let hasError = false
    await Promise.all(
      functionARNs.map(async (fn) => {
        try {
          const roleName = await getRoleName(lambdaClient, fn)
          await disableCloudwatchLogs(iamClient, roleName)
          this.context.stdout.write(cloudwatchRenderer.renderFunctionSuccess('disable', fn, roleName))
        } catch (err) {
          hasError = true
          this.context.stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
        }
      })
    )

    if (hasError) {
      spinner.fail(cloudwatchRenderer.renderFailedProcessingFunctions(region))

      return 1
    }

    spinner.succeed(cloudwatchRenderer.renderProcessedFunctions(region, functionARNs.length))

    return 0
  }
}
