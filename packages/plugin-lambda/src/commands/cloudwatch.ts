import {IAMClient} from '@aws-sdk/client-iam'
import {LambdaClient} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import {LambdaCloudwatchCommand} from '@datadog/datadog-ci-base/commands/lambda/cloudwatch'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import * as helperRenderer from '@datadog/datadog-ci-base/helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'

import {ADAPTIVE_RETRY_STRATEGY, AWS_DEFAULT_REGION_ENV_VAR} from '../constants'
import {disableCloudwatchLogs, enableCloudwatchLogs, getFunctionDetails} from '../functions/cloudwatch'
import {
  collectFunctionsByRegion,
  getAWSProfileCredentials,
  getLambdaFunctionConfigsFromRegex,
} from '../functions/commons'
import {LambdaConfigOptions} from '../interfaces'
import * as cloudwatchRenderer from '../renderers/cloudwatch-renderer'
import * as commonRenderer from '../renderers/common-renderer'

type CloudwatchAction = (iamClient: IAMClient, roleName: string, logGroups: string[]) => Promise<void>

export class PluginCommand extends LambdaCloudwatchCommand {
  private lambdaClients = new Map<string, LambdaClient>()
  private iamClients = new Map<string, IAMClient>()

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

      const lambdaClient = this.getLambdaClient(region, credentials)
      const iamClient = this.getIAMClient(region, credentials)

      try {
        const matchedFunctions = await getLambdaFunctionConfigsFromRegex(lambdaClient, this.regExPattern!)
        const functionARNs = matchedFunctions.map((fn) => fn.FunctionArn!).filter(Boolean)

        const result = await this.processRegion(functionARNs, lambdaClient, iamClient)

        return this.writeSummary(result)
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
      Object.entries(functionGroups).map(([region, functionARNs]) =>
        this.processRegion(
          functionARNs,
          this.getLambdaClient(region, credentials),
          this.getIAMClient(region, credentials)
        )
      )
    )

    const totals = results.reduce(
      (acc, r) => ({successes: acc.successes + r.successes, failures: acc.failures + r.failures}),
      {successes: 0, failures: 0}
    )

    return this.writeSummary(totals)
  }

  private getLambdaClient(region: string, credentials?: AwsCredentialIdentity): LambdaClient {
    let client = this.lambdaClients.get(region)
    if (!client) {
      client = new LambdaClient({region, credentials, retryStrategy: ADAPTIVE_RETRY_STRATEGY})
      this.lambdaClients.set(region, client)
    }

    return client
  }

  private getIAMClient(region: string, credentials?: AwsCredentialIdentity): IAMClient {
    let client = this.iamClients.get(region)
    if (!client) {
      client = new IAMClient({region, credentials, retryStrategy: ADAPTIVE_RETRY_STRATEGY})
      this.iamClients.set(region, client)
    }

    return client
  }

  private writeSummary({successes, failures}: {successes: number; failures: number}): 0 | 1 {
    const stdout = this.context.stdout
    if (failures > 0) {
      stdout.write(cloudwatchRenderer.renderSummaryFailure(this.action, successes, failures))

      return 1
    }
    stdout.write(cloudwatchRenderer.renderSummarySuccess(this.action, successes))

    return 0
  }

  private async processRegion(
    functionARNs: string[],
    lambdaClient: LambdaClient,
    iamClient: IAMClient
  ): Promise<{successes: number; failures: number}> {
    const stdout = this.context.stdout
    let successes = 0
    let failures = 0

    // Fetch details for all functions and group by role
    const roleMap = new Map<string, {logGroups: string[]; functionARNs: string[]}>()
    for (const fn of functionARNs) {
      try {
        const {roleName, logGroup, hasExtensionLayer} = await getFunctionDetails(lambdaClient, fn)
        if (this.action === 'disable' && !hasExtensionLayer) {
          stdout.write(cloudwatchRenderer.renderNoExtensionWarning(fn))
        }
        const entry = roleMap.get(roleName) ?? {logGroups: [], functionARNs: []}
        entry.logGroups.push(logGroup)
        entry.functionARNs.push(fn)
        roleMap.set(roleName, entry)
      } catch (err) {
        failures++
        stdout.write(cloudwatchRenderer.renderFunctionError(fn, err))
      }
    }

    if (this.dryRun) {
      for (const [roleName, {functionARNs: arns}] of roleMap) {
        stdout.write(cloudwatchRenderer.renderDryRunRoleAction(this.action, roleName, arns))
        successes += arns.length
      }

      return {successes, failures}
    }

    for (const [roleName, {logGroups, functionARNs: arns}] of roleMap) {
      try {
        await this.cloudwatchAction(iamClient, roleName, logGroups)
        stdout.write(cloudwatchRenderer.renderRoleSuccess(this.action, roleName, arns))
        successes += arns.length
      } catch (err) {
        failures += arns.length
        stdout.write(cloudwatchRenderer.renderRoleError(roleName, arns, err))
      }
    }

    return {successes, failures}
  }
}
