import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  FIPS_ENV_VAR,
  FIPS_IGNORE_ERROR_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {handleSourceCodeIntegration} from '../../helpers/git/instrument-helpers'
import {requestConfirmation} from '../../helpers/prompt'
import * as helperRenderer from '../../helpers/renderer'
import {resolveConfigFromFile, DEFAULT_CONFIG_PATHS} from '../../helpers/utils'

import {AWS_DEFAULT_REGION_ENV_VAR, EXPONENTIAL_BACKOFF_RETRY_STRATEGY} from './constants'
import {
  checkRuntimeTypesAreUniform,
  coerceBoolean,
  collectFunctionsByRegion,
  getAWSProfileCredentials,
  getAllLambdaFunctionConfigs,
  handleLambdaFunctionUpdates,
  getAWSCredentials,
  isMissingDatadogEnvVars,
  sentenceMatchesRegEx,
  willUpdateFunctionConfigs,
  maskConfig,
} from './functions/commons'
import {getInstrumentedFunctionConfigs, getInstrumentedFunctionConfigsFromRegEx} from './functions/instrument'
import {
  FunctionConfiguration,
  InstrumentationSettings,
  InstrumentedConfigurationGroup,
  LambdaConfigOptions,
} from './interfaces'
import {
  requestAWSCredentials,
  requestAWSRegion,
  requestDatadogEnvVars,
  requestEnvServiceVersion,
  requestFunctionSelection,
} from './prompt'
import * as commonRenderer from './renderers/common-renderer'
import * as instrumentRenderer from './renderers/instrument-uninstrument-renderer'

export class InstrumentCommand extends Command {
  public static paths = [['lambda', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Lambda.',
  })

  private apmFlushDeadline = Option.String('--apm-flush-deadline')
  private appsecEnabled = Option.Boolean('--appsec', false)
  private captureLambdaPayload = Option.String('--capture-lambda-payload,--captureLambdaPayload')
  private configPath = Option.String('--config')
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private environment = Option.String('--env')
  private extensionVersion = Option.String('-e,--extension-version,--extensionVersion')
  private extraTags = Option.String('--extra-tags,--extraTags')
  private flushMetricsToLogs = Option.String('--flush-metrics-to-logs,--flushMetricsToLogs')
  private forwarder = Option.String('--forwarder')
  private functions = Option.Array('-f,--function', [])
  private interactive = Option.Boolean('-i,--interactive', false)
  private layerAWSAccount = Option.String('-a,--layer-account,--layerAccount', {hidden: true})
  private layerVersion = Option.String('-v,--layer-version,--layerVersion')
  private logging = Option.String('--logging')
  private logLevel = Option.String('--log-level,--logLevel')
  private mergeXrayTraces = Option.String('--merge-xray-traces,--mergeXrayTraces')
  private profile = Option.String('--profile')
  private regExPattern = Option.String('--functions-regex,--functionsRegex')
  private region = Option.String('-r,--region')
  private service = Option.String('--service')
  private sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true)
  private uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true)
  private tracing = Option.String('--tracing')
  private version = Option.String('--version')
  private llmobs = Option.String('--llmobs')

  private config: LambdaConfigOptions = {
    functions: [],
    tracing: 'true',
    logging: 'true',
  }

  private credentials?: AwsCredentialIdentity

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
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

        // Always ask for region since the user may
        // not want to use the default, nonetheless,
        // we do not ask if `-r|--region` is provided.
        if (this.region === undefined && this.config.region === undefined) {
          this.context.stdout.write(instrumentRenderer.renderConfigureAWSRegion())
          await requestAWSRegion(process.env[AWS_DEFAULT_REGION_ENV_VAR])
        }

        if (isMissingDatadogEnvVars()) {
          this.context.stdout.write(instrumentRenderer.renderConfigureDatadog())
          await requestDatadogEnvVars()
        }
      } catch (err) {
        this.context.stdout.write(helperRenderer.renderError(err))

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      this.region = region

      // If user doesn't specify functions, allow them
      // to select from all of the functions from the
      // requested region.
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

      try {
        await requestEnvServiceVersion()
      } catch (err) {
        this.context.stdout.write(
          helperRenderer.renderError(`Grabbing env, service, and version values from user. ${err}`)
        )

        return 1
      }

      this.setEnvServiceVersion()
    }

    const settings = this.getSettings()
    if (settings === undefined) {
      return 1
    }

    hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write(instrumentRenderer.renderNoFunctionsSpecifiedError(Object.getPrototypeOf(this)))

      return 1
    }
    if (settings.extensionVersion && settings.forwarderARN) {
      this.context.stdout.write(instrumentRenderer.renderExtensionAndForwarderOptionsBothSetError())

      return 1
    }

    if (this.sourceCodeIntegration) {
      settings.extraTags = await handleSourceCodeIntegration(this.context, this.uploadGitMetadata, settings.extraTags)
    }

    const configGroups: InstrumentedConfigurationGroup[] = []

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

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
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
        const configs = await getInstrumentedFunctionConfigsFromRegEx(
          lambdaClient,
          cloudWatchLogsClient,
          region,
          this.regExPattern!,
          settings
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
        const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
        functionGroups = collectFunctionsByRegion(
          this.functions.length !== 0 ? this.functions : this.config.functions,
          region
        )
      } catch (err) {
        this.context.stdout.write(instrumentRenderer.renderCouldntGroupFunctionsError(err))

        return 1
      }

      for (const [region, functionList] of Object.entries(functionGroups)) {
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
          const configs = await getInstrumentedFunctionConfigs(
            lambdaClient,
            cloudWatchLogsClient,
            region,
            functionList,
            settings
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

    if (!checkRuntimeTypesAreUniform(configList)) {
      throw Error(
        'Detected Lambda functions using different runtimes. Please only instrument batches of functions that share a similar runtime'
      )
    }

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
      this.context.stdout.write(instrumentRenderer.renderInstrumentingFunctionsSoftWarning())
    }

    if (willUpdate) {
      try {
        await handleLambdaFunctionUpdates(configGroups, this.context.stdout)
      } catch {
        return 1
      }
    }

    return 0
  }

  private getSettings(): InstrumentationSettings | undefined {
    const layerVersionStr = this.layerVersion ?? this.config.layerVersion
    const extensionVersionStr = this.extensionVersion ?? this.config.extensionVersion
    const layerAWSAccount = this.layerAWSAccount ?? this.config.layerAWSAccount
    const forwarderARN = this.forwarder ?? this.config.forwarder

    let layerVersion
    if (layerVersionStr !== undefined) {
      layerVersion = parseInt(layerVersionStr, 10)
    }
    if (Number.isNaN(layerVersion)) {
      this.context.stdout.write(instrumentRenderer.renderInvalidLayerVersionError(layerVersion?.toString()))

      return
    }

    let extensionVersion: number | undefined
    if (extensionVersionStr !== undefined) {
      extensionVersion = parseInt(extensionVersionStr, 10)
    }

    if (Number.isNaN(extensionVersion)) {
      this.context.stdout.write(instrumentRenderer.renderInvalidExtensionVersionError(extensionVersion?.toString()))

      return
    }

    const stringBooleansMap: {[key: string]: string | undefined} = {
      captureLambdaPayload: this.captureLambdaPayload ?? this.config.captureLambdaPayload,
      flushMetricsToLogs: this.flushMetricsToLogs ?? this.config.flushMetricsToLogs,
      logging: this.logging ?? this.config.logging,
      mergeXrayTraces: this.mergeXrayTraces ?? this.config.mergeXrayTraces,
      tracing: this.tracing ?? this.config.tracing,
    }

    for (const [stringBoolean, value] of Object.entries(stringBooleansMap)) {
      if (!['true', 'false', undefined].includes(value?.toString().toLowerCase())) {
        this.context.stdout.write(instrumentRenderer.renderInvalidStringBooleanSpecifiedError(stringBoolean))

        return
      }
    }

    const captureLambdaPayload = coerceBoolean(false, this.captureLambdaPayload, this.config.captureLambdaPayload)
    const flushMetricsToLogs = coerceBoolean(true, this.flushMetricsToLogs, this.config.flushMetricsToLogs)
    const loggingEnabled = coerceBoolean(true, this.logging, this.config.logging)
    const mergeXrayTraces = coerceBoolean(false, this.mergeXrayTraces, this.config.mergeXrayTraces)
    const tracingEnabled = coerceBoolean(true, this.tracing, this.config.tracing)
    const interactive = coerceBoolean(false, this.interactive, this.config.interactive)
    const logLevel = this.logLevel ?? this.config.logLevel
    const apmFlushDeadline = this.apmFlushDeadline ?? this.config.apmFlushDeadline
    const appsecEnabled = this.appsecEnabled ?? this.config.appsecEnabled

    const service = this.service ?? this.config.service
    const environment = this.environment ?? this.config.environment
    const version = this.version ?? this.config.version

    const llmobsMlApp = this.llmobs ?? this.config.llmobs

    const tagsMap: {[key: string]: string | undefined} = {
      environment,
      service,
      version,
    }
    const tagsMissing = []
    for (const [tag, value] of Object.entries(tagsMap)) {
      if (!value) {
        tagsMissing.push(tag)
      }
    }
    if (tagsMissing.length > 0) {
      this.context.stdout.write(instrumentRenderer.renderTagsNotConfiguredWarning(tagsMissing))
    }

    const extraTags = this.extraTags?.toLowerCase() ?? this.config.extraTags?.toLowerCase()
    if (extraTags && !sentenceMatchesRegEx(extraTags, EXTRA_TAGS_REG_EXP)) {
      this.context.stdout.write(instrumentRenderer.renderExtraTagsDontComplyError())

      return
    }

    return {
      apmFlushDeadline,
      appsecEnabled,
      captureLambdaPayload,
      environment,
      extensionVersion,
      extraTags,
      fips: this.fips || this.fipsConfig.fips,
      flushMetricsToLogs,
      forwarderARN,
      interactive,
      layerAWSAccount,
      layerVersion,
      loggingEnabled,
      logLevel,
      mergeXrayTraces,
      service,
      tracingEnabled,
      version,
      llmobsMlApp,
    }
  }

  private printPlannedActions(configs: FunctionConfiguration[]): void {
    const willUpdate = willUpdateFunctionConfigs(configs)
    if (!willUpdate) {
      this.context.stdout.write(instrumentRenderer.renderNoUpdatesApplied(this.dryRun))

      return
    }
    this.context.stdout.write(instrumentRenderer.renderInstrumentInStagingFirst())

    this.context.stdout.write(instrumentRenderer.renderFunctionsToBeUpdated())
    for (const config of configs) {
      this.context.stdout.write(`\t- ${chalk.bold(config.functionARN)}\n`)

      // Later, we should inform which layer is the latest.
      if (this.interactive) {
        if (!this.extensionVersion || !this.extensionVersion) {
          this.context.stdout.write(instrumentRenderer.renderEnsureToLockLayerVersionsWarning())
        }
      }
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
      if (tagConfiguration?.tagResourceCommandInput) {
        this.context.stdout.write(
          `TagResource -> ${tagConfiguration.tagResourceCommandInput.Resource}\n${JSON.stringify(
            tagConfiguration.tagResourceCommandInput.Tags,
            undefined,
            2
          )}\n`
        )
      }
      if (logGroupConfiguration?.createLogGroupCommandInput) {
        this.context.stdout.write(
          `CreateLogGroup -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.createLogGroupCommandInput,
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
      if (logGroupConfiguration?.putSubscriptionFilterCommandInput) {
        this.context.stdout.write(
          `PutSubscriptionFilter -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.putSubscriptionFilterCommandInput,
            undefined,
            2
          )}\n`
        )
      }
    }
  }

  private setEnvServiceVersion(): void {
    this.environment = process.env[ENVIRONMENT_ENV_VAR] || undefined
    this.service = process.env[SERVICE_ENV_VAR] || undefined
    this.version = process.env[VERSION_ENV_VAR] || undefined
  }
}
