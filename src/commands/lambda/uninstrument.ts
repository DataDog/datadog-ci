import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {requestConfirmation} from '../../helpers/prompt'
import * as helperRenderer from '../../helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'

import { AWS_DEFAULT_REGION_ENV_VAR, EXPONENTIAL_BACKOFF_RETRY_STRATEGY, LAMBDA_FIPS_ENV_VAR } from "./constants";
import {
  collectFunctionsByRegion,
  getAllLambdaFunctionConfigs,
  getAWSProfileCredentials,
  handleLambdaFunctionUpdates,
  getAWSCredentials,
  willUpdateFunctionConfigs,
  maskConfig,
} from './functions/commons'
import {getUninstrumentedFunctionConfigs, getUninstrumentedFunctionConfigsFromRegEx} from './functions/uninstrument'
import {FunctionConfiguration} from './interfaces'
import {requestAWSCredentials, requestFunctionSelection} from './prompt'
import * as commonRenderer from './renderers/common-renderer'
import * as instrumentRenderer from './renderers/instrument-uninstrument-renderer'

export class UninstrumentCommand extends Command {
  public static paths = [['lambda', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Lambda.',
  })

  private configPath = Option.String('--config')
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private forwarder = Option.String('--forwarder')
  private functions = Option.Array('-f,--function', [])
  private interactive = Option.Boolean('-i,--interactive', false)
  private profile = Option.String('--profile')
  private regExPattern = Option.String('--functions-regex,--functionsRegex')
  private region = Option.String('-r,--region')

  /**
   * Arguments that are not really in use, but to
   * make uninstrumentation easier for the user.
   */
  private layerVersion = Option.String('-v,--layer-version,--layerVersion', {hidden: true})
  private tracing = Option.String('--tracing', {hidden: true})
  private logLevel = Option.String('--log-level,--logLevel', {hidden: true})
  private service = Option.String('--service', {hidden: true})
  private environment = Option.String('--env', {hidden: true})
  private version = Option.String('--version', {hidden: true})
  private appsecEnabled = Option.Boolean('--appsec', {hidden: true})
  private apmFlushDeadline = Option.String('--apm-flush-deadline', {hidden: true})
  private extraTags = Option.String('--extra-tags,--extraTags', {hidden: true})
  private extensionVersion = Option.String('-e,--extension-version,--extensionVersion', {hidden: true})
  private mergeXrayTraces = Option.String('--merge-xray-traces,--mergeXrayTraces', {hidden: true})
  private flushMetricsToLogs = Option.String('--flush-metrics-to-logs,--flushMetricsToLogs', {hidden: true})
  private captureLambdaPayload = Option.String('--capture-lambda-payload,--captureLambdaPayload', {hidden: true})

  private config: any = {
    functions: [],
    region: process.env[AWS_DEFAULT_REGION_ENV_VAR],
  }

  private credentials?: AwsCredentialIdentity

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private lambdaFips = Option.Boolean('--lambda-fips', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
    lambdaFips: toBoolean(process.env[LAMBDA_FIPS_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.context.stdout.write(instrumentRenderer.renderLambdaHeader(Object.getPrototypeOf(this), this.dryRun))

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

    let hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (this.interactive) {
      try {
        const credentials = await getAWSCredentials()
        if (credentials === undefined) {
          this.context.stdout.write(commonRenderer.renderNoAWSCredentialsFound())
          await requestAWSCredentials()
        } else {
          this.credentials = credentials
        }
      } catch (err) {
        this.context.stdout.write(helperRenderer.renderError(err))

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      this.region = region

      if (!hasSpecifiedFunctions) {
        const spinner = instrumentRenderer.fetchingFunctionsSpinner()
        try {
          const lambdaClientConfig: LambdaClientConfig = {
            region,
            credentials: this.credentials,
            retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
          }

          const lambdaClient = new LambdaClient(lambdaClientConfig)
          spinner.start()
          const functionNames =
            (await getAllLambdaFunctionConfigs(lambdaClient)).map((config) => config.FunctionName!).sort() ?? []
          if (functionNames.length === 0) {
            this.context.stdout.write(instrumentRenderer.renderCouldntFindLambdaFunctionsInRegionError())

            return 1
          }
          spinner.succeed(instrumentRenderer.renderFetchedLambdaFunctions(functionNames.length))

          const functions = await requestFunctionSelection(functionNames)
          this.functions = functions
        } catch (err) {
          spinner.fail(instrumentRenderer.renderFailedFetchingLambdaFunctions())
          this.context.stdout.write(instrumentRenderer.renderCouldntFetchLambdaFunctionsError(err))

          return 1
        }
      }
    }

    hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write(instrumentRenderer.renderNoFunctionsSpecifiedError(Object.getPrototypeOf(this)))

      return 1
    }

    const configGroups: {
      cloudWatchLogsClient: CloudWatchLogsClient
      configs: FunctionConfiguration[]
      lambdaClient: LambdaClient
      region: string
    }[] = []

    // Fetch lambda function configurations that are
    // available to be un-instrumented.
    if (hasSpecifiedRegExPattern) {
      if (hasSpecifiedFunctions) {
        this.context.stdout.write(
          instrumentRenderer.renderFunctionsAndFunctionsRegexOptionsBothSetError(this.functions.length !== 0)
        )

        return 1
      }
      if (this.regExPattern!.match(':')) {
        this.context.stdout.write(instrumentRenderer.renderRegexSetWithARNError())

        return 1
      }

      const region = this.region || this.config.region
      if (!region) {
        this.context.stdout.write(commonRenderer.renderNoDefaultRegionSpecifiedError())

        return 1
      }

      const spinner = instrumentRenderer.fetchingFunctionsSpinner()
      try {
        const cloudWatchLogsClient = new CloudWatchLogsClient({
          region,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        })

        const lambdaClientConfig: LambdaClientConfig = {
          region,
          credentials: this.credentials,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        }

        const lambdaClient = new LambdaClient(lambdaClientConfig)
        spinner.start()
        const configs = await getUninstrumentedFunctionConfigsFromRegEx(
          lambdaClient,
          cloudWatchLogsClient,
          this.regExPattern!,
          this.forwarder
        )
        spinner.succeed(instrumentRenderer.renderFetchedLambdaFunctions(configs.length))

        configGroups.push({configs, lambdaClient, cloudWatchLogsClient, region})
      } catch (err) {
        spinner.fail(instrumentRenderer.renderFailedFetchingLambdaFunctions())
        this.context.stdout.write(instrumentRenderer.renderCouldntFetchLambdaFunctionsError(err))

        return 1
      }
    } else {
      let functionGroups
      try {
        functionGroups = collectFunctionsByRegion(
          this.functions.length !== 0 ? this.functions : this.config.functions,
          this.region || this.config.region
        )
      } catch (err) {
        this.context.stdout.write(instrumentRenderer.renderCouldntGroupFunctionsError(err))

        return 1
      }

      for (const [region, functionARNs] of Object.entries(functionGroups)) {
        const spinner = instrumentRenderer.fetchingFunctionsConfigSpinner(region)
        spinner.start()
        const lambdaClientConfig: LambdaClientConfig = {
          region,
          credentials: this.credentials,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        }

        const lambdaClient = new LambdaClient(lambdaClientConfig)
        const cloudWatchLogsClient = new CloudWatchLogsClient({
          region,
          retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
        })
        try {
          const configs = await getUninstrumentedFunctionConfigs(
            lambdaClient,
            cloudWatchLogsClient,
            functionARNs,
            this.forwarder
          )
          configGroups.push({configs, lambdaClient, cloudWatchLogsClient, region})
          spinner.succeed(instrumentRenderer.renderFetchedLambdaConfigurationsFromRegion(region, configs.length))
        } catch (err) {
          spinner.fail(instrumentRenderer.renderFailedFetchingLambdaConfigurationsFromRegion(region))
          this.context.stdout.write(instrumentRenderer.renderCouldntFetchLambdaFunctionsError(err))

          return 1
        }
      }
    }

    const configList = configGroups.map((group) => group.configs).reduce((a, b) => a.concat(b))
    this.printPlannedActions(configList)
    if (this.dryRun || configList.length === 0) {
      return 0
    }

    const willUpdate = willUpdateFunctionConfigs(configList)
    if (this.interactive && willUpdate) {
      this.context.stdout.write(instrumentRenderer.renderConfirmationNeededSoftWarning())
      const isConfirmed = await requestConfirmation('Do you want to apply the changes?')
      if (!isConfirmed) {
        return 0
      }
      this.context.stdout.write(instrumentRenderer.renderUninstrumentingFunctionsSoftWarning())
    }

    // Un-instrument functions.
    if (willUpdate) {
      if (willUpdate) {
        try {
          await handleLambdaFunctionUpdates(configGroups, this.context.stdout)
        } catch {
          return 1
        }
      }
    }

    return 0
  }

  private printPlannedActions(configs: FunctionConfiguration[]): void {
    const willUpdate = willUpdateFunctionConfigs(configs)

    if (!willUpdate) {
      this.context.stdout.write(instrumentRenderer.renderNoUpdatesApplied(this.dryRun))

      return
    }

    this.context.stdout.write(instrumentRenderer.renderFunctionsToBeUpdated())
    for (const config of configs) {
      this.context.stdout.write(`\t- ${chalk.bold(config.functionARN)}\n`)
    }

    this.context.stdout.write(instrumentRenderer.renderWillApplyUpdates(this.dryRun))
    for (const config of configs) {
      if (config.updateFunctionConfigurationCommandInput) {
        const maskedConfig = maskConfig(config.updateFunctionConfigurationCommandInput)
        this.context.stdout.write(
          `UpdateFunctionConfiguration -> ${config.functionARN}\n${JSON.stringify(maskedConfig, undefined, 2)}\n`
        )
      }
      const {logGroupConfiguration, tagConfiguration} = config
      if (tagConfiguration?.untagResourceCommandInput) {
        this.context.stdout.write(
          `UntagResource -> ${tagConfiguration.untagResourceCommandInput.Resource}\n${JSON.stringify(
            tagConfiguration.untagResourceCommandInput.TagKeys,
            undefined,
            2
          )}\n`
        )
      }
      if (logGroupConfiguration?.deleteSubscriptionFilterCommandInput) {
        this.context.stdout.write(
          `DeleteSubscriptionFilter -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.deleteSubscriptionFilterCommandInput,
            undefined,
            2
          )}\n`
        )
      }
    }
  }
}
