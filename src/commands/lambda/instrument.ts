import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {bold} from 'chalk'
import {Cli, Command} from 'clipanion'

import {resolveConfigFromFile} from '../../helpers/utils'

import {getCommitInfo, newSimpleGit} from '../git-metadata/git'
import {UploadCommand} from '../git-metadata/upload'

import {
  AWS_DEFAULT_REGION_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from './constants'
import {
  checkRuntimeTypesAreUniform,
  coerceBoolean,
  collectFunctionsByRegion,
  getAllLambdaFunctionConfigs,
  isMissingAWSCredentials,
  isMissingDatadogEnvVars,
  sentenceMatchesRegEx,
  updateAWSProfileCredentials,
  updateLambdaFunctionConfigs,
  willUpdateFunctionConfigs,
} from './functions/commons'
import {getInstrumentedFunctionConfigs, getInstrumentedFunctionConfigsFromRegEx} from './functions/instrument'
import {FunctionConfiguration, InstrumentationSettings, LambdaConfigOptions} from './interfaces'
import {
  requestAWSCredentials,
  requestAWSRegion,
  requestChangesConfirmation,
  requestDatadogEnvVars,
  requestEnvServiceVersion,
  requestFunctionSelection,
} from './prompt'
import * as renderer from './renderer'

export class InstrumentCommand extends Command {
  private captureLambdaPayload?: string
  private config: LambdaConfigOptions = {
    functions: [],
    tracing: 'true',
  }
  private configPath?: string
  private dryRun = false
  private environment?: string
  private extensionVersion?: string
  private extraTags?: string
  private flushMetricsToLogs?: string
  private forwarder?: string
  private functions: string[] = []
  private interactive = false
  private layerAWSAccount?: string
  private layerVersion?: string
  private logLevel?: string
  private mergeXrayTraces?: string
  private profile?: string
  private regExPattern?: string
  private region?: string
  private service?: string
  private sourceCodeIntegration = false
  private tracing?: string
  private version?: string

  public async execute() {
    this.context.stdout.write(renderer.renderLambdaHeader(Object.getPrototypeOf(this), this.dryRun))

    const lambdaConfig = {lambda: this.config}
    this.config = (
      await resolveConfigFromFile(lambdaConfig, {configPath: this.configPath, defaultConfigPath: 'datadog-ci.json'})
    ).lambda

    const profile = this.profile ?? this.config.profile
    if (profile) {
      try {
        await updateAWSProfileCredentials(profile)
      } catch (e) {
        this.context.stdout.write(renderer.renderError(e))

        return 1
      }
    }

    let hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (this.interactive) {
      try {
        if (isMissingAWSCredentials()) {
          this.context.stdout.write(renderer.renderNoAWSCredentialsFound())
          await requestAWSCredentials()
        }

        // Always ask for region since the user may
        // not want to use the default, nonetheless,
        // we do not ask if `-r|--region` is provided.
        if (this.region === undefined && this.config.region === undefined) {
          this.context.stdout.write(renderer.renderConfigureAWSRegion())
          await requestAWSRegion(process.env[AWS_DEFAULT_REGION_ENV_VAR])
        }

        if (isMissingDatadogEnvVars()) {
          this.context.stdout.write(renderer.renderConfigureDatadog())
          await requestDatadogEnvVars()
        }
      } catch (e) {
        this.context.stdout.write(renderer.renderError(e))

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      this.region = region

      // If user doesn't specify functions, allow them
      // to select from all of the functions from the
      // requested region.
      if (!hasSpecifiedFunctions) {
        const spinner = renderer.fetchingFunctionsSpinner()
        try {
          const lambda = new Lambda({region})
          spinner.start()
          const functionNames =
            (await getAllLambdaFunctionConfigs(lambda)).map((config) => config.FunctionName!).sort() ?? []
          if (functionNames.length === 0) {
            this.context.stdout.write(renderer.renderCouldntFindLambdaFunctionsInRegionError())

            return 1
          }
          spinner.succeed(renderer.renderFetchedLambdaFunctions(functionNames.length))

          const functions = await requestFunctionSelection(functionNames)
          this.functions = functions
        } catch (err) {
          spinner.fail(renderer.renderFailedFetchingLambdaFunctions())
          this.context.stdout.write(renderer.renderCouldntFetchLambdaFunctionsError(err))

          return 1
        }
      }

      try {
        await requestEnvServiceVersion()
      } catch (err) {
        this.context.stdout.write(renderer.renderError(`Grabbing env, service, and version values from user. ${err}`))

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
      this.context.stdout.write(renderer.renderNoFunctionsSpecifiedError(Object.getPrototypeOf(this)))

      return 1
    }
    if (settings.extensionVersion && settings.forwarderARN) {
      this.context.stdout.write(renderer.renderExtensionAndForwarderOptionsBothSetError())

      return 1
    }

    if (this.sourceCodeIntegration) {
      if (!process.env.DATADOG_API_KEY) {
        this.context.stdout.write(renderer.renderMissingDatadogApiKeyError())

        return 1
      }
      try {
        const gitData = await this.getGitData()
        if (settings.extraTags) {
          settings.extraTags += `,git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
        } else {
          settings.extraTags = `git.commit.sha:${gitData.commitSha},git.repository_url:${gitData.gitRemote}`
        }
      } catch (err) {
        this.context.stdout.write(renderer.renderError(err))

        return 1
      }
    }

    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
      region: string
    }[] = []

    if (hasSpecifiedRegExPattern) {
      if (hasSpecifiedFunctions) {
        this.context.stdout.write(
          renderer.renderFunctionsAndFunctionsRegexOptionsBothSetError(this.functions.length !== 0)
        )

        return 1
      }
      if (this.regExPattern!.match(':')) {
        this.context.stdout.write(renderer.renderRegexSetWithARNError())

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      if (!region) {
        this.context.stdout.write(renderer.renderNoDefaultRegionSpecifiedError())

        return 1
      }

      const spinner = renderer.fetchingFunctionsSpinner()
      try {
        const cloudWatchLogs = new CloudWatchLogs({region})
        const lambda = new Lambda({region})
        spinner.start()
        const configs = await getInstrumentedFunctionConfigsFromRegEx(
          lambda,
          cloudWatchLogs,
          region,
          this.regExPattern!,
          settings
        )
        spinner.succeed(renderer.renderFetchedLambdaFunctions(configs.length))

        configGroups.push({configs, lambda, cloudWatchLogs, region})
      } catch (err) {
        spinner.fail(renderer.renderFailedFetchingLambdaFunctions())
        this.context.stdout.write(renderer.renderCouldntFetchLambdaFunctionsError(err))

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
        this.context.stdout.write(renderer.renderCouldntGroupFunctionsError(err))

        return 1
      }

      for (const [region, functionList] of Object.entries(functionGroups)) {
        const spinner = renderer.fetchingFunctionsConfigSpinner(region)
        spinner.start()
        const lambda = new Lambda({region})
        const cloudWatchLogs = new CloudWatchLogs({region})
        try {
          const configs = await getInstrumentedFunctionConfigs(lambda, cloudWatchLogs, region, functionList, settings)
          configGroups.push({configs, lambda, cloudWatchLogs, region})
          spinner.succeed(renderer.renderFetchedLambdaConfigurationsFromRegion(region, configs.length))
        } catch (err) {
          spinner.fail(renderer.renderFailedFetchingLambdaConfigurationsFromRegion(region))
          this.context.stdout.write(renderer.renderCouldntFetchLambdaFunctionsError(err))

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
      this.context.stdout.write(renderer.renderConfirmationNeededSoftWarning())
      const isConfirmed = await requestChangesConfirmation('Do you want to apply the changes?')
      if (!isConfirmed) {
        return 0
      }
      this.context.stdout.write(renderer.renderInstrumentingFunctionsSoftWarning())
    }

    if (willUpdate) {
      const promises = Object.values(configGroups).map((group) =>
        updateLambdaFunctionConfigs(group.lambda, group.cloudWatchLogs, group.configs)
      )
      const spinner = renderer.updatingFunctionsSpinner(promises.length)
      spinner.start()
      try {
        await Promise.all(promises)
        spinner.succeed(renderer.renderUpdatedLambdaFunctions(promises.length))
      } catch (err) {
        this.context.stdout.write(renderer.renderFailureDuringUpdateError(err))
        spinner.fail(renderer.renderFailedUpdatingLambdaFunctions())

        return 1
      }
    }

    return 0
  }

  private async getCurrentGitStatus() {
    const simpleGit = await newSimpleGit()
    const gitCommitInfo = await getCommitInfo(simpleGit)
    if (gitCommitInfo === undefined) {
      throw new Error('Git commit info is not defined')
    }
    const status = await simpleGit.status()

    return {isClean: status.isClean(), ahead: status.ahead, files: status.files, hash: gitCommitInfo?.hash, remote: gitCommitInfo?.remote}
  }

  private async getGitData() {
    let currentStatus

    try {
      currentStatus = await this.getCurrentGitStatus()
    } catch (err) {
      throw Error("Couldn't get local git status")
    }

    if (!currentStatus.isClean) {
      throw Error('Local git repository is dirty')
    }

    if (currentStatus.ahead > 0) {
      throw Error('Local changes have not been pushed remotely. Aborting git upload.')
    }

    return {commitSha: currentStatus.hash, gitRemote: currentStatus.remote}
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
      this.context.stdout.write(renderer.renderInvalidLayerVersionError(layerVersion?.toString()))

      return
    }

    let extensionVersion: number | undefined
    if (extensionVersionStr !== undefined) {
      extensionVersion = parseInt(extensionVersionStr, 10)
    }

    if (Number.isNaN(extensionVersion)) {
      this.context.stdout.write(renderer.renderInvalidExtensionVersionError(extensionVersion?.toString()))

      return
    }

    const stringBooleansMap: {[key: string]: string | undefined} = {
      captureLambdaPayload: this.captureLambdaPayload ?? this.config.captureLambdaPayload,
      flushMetricsToLogs: this.flushMetricsToLogs ?? this.config.flushMetricsToLogs,
      mergeXrayTraces: this.mergeXrayTraces ?? this.config.mergeXrayTraces,
      tracing: this.tracing ?? this.config.tracing,
    }

    for (const [stringBoolean, value] of Object.entries(stringBooleansMap)) {
      if (!['true', 'false', undefined].includes(value?.toString().toLowerCase())) {
        this.context.stdout.write(renderer.renderInvalidStringBooleanSpecifiedError(stringBoolean))

        return
      }
    }

    const captureLambdaPayload = coerceBoolean(false, this.captureLambdaPayload, this.config.captureLambdaPayload)
    const flushMetricsToLogs = coerceBoolean(true, this.flushMetricsToLogs, this.config.flushMetricsToLogs)
    const mergeXrayTraces = coerceBoolean(false, this.mergeXrayTraces, this.config.mergeXrayTraces)
    const tracingEnabled = coerceBoolean(true, this.tracing, this.config.tracing)
    const interactive = coerceBoolean(false, this.interactive, this.config.interactive)
    const logLevel = this.logLevel ?? this.config.logLevel

    const service = this.service ?? this.config.service
    const environment = this.environment ?? this.config.environment
    const version = this.version ?? this.config.version

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
      this.context.stdout.write(renderer.renderTagsNotConfiguredWarning(tagsMissing))
    }

    const extraTags = this.extraTags?.toLowerCase() ?? this.config.extraTags?.toLowerCase()
    if (extraTags && !sentenceMatchesRegEx(extraTags, EXTRA_TAGS_REG_EXP)) {
      this.context.stdout.write(renderer.renderExtraTagsDontComplyError())

      return
    }

    return {
      captureLambdaPayload,
      environment,
      extensionVersion,
      extraTags,
      flushMetricsToLogs,
      forwarderARN,
      interactive,
      layerAWSAccount,
      layerVersion,
      logLevel,
      mergeXrayTraces,
      service,
      tracingEnabled,
      version,
    }
  }

  private printPlannedActions(configs: FunctionConfiguration[]) {
    const willUpdate = willUpdateFunctionConfigs(configs)
    if (!willUpdate) {
      this.context.stdout.write(renderer.renderNoUpdatesApplied(this.dryRun))

      return
    }
    this.context.stdout.write(renderer.renderInstrumentInStagingFirst())

    this.context.stdout.write(renderer.renderFunctionsToBeUpdated())
    for (const config of configs) {
      this.context.stdout.write(`\t- ${bold(config.functionARN)}\n`)

      // Later, we should inform which layer is the latest.
      if (this.interactive) {
        if (!this.extensionVersion || !this.extensionVersion) {
          this.context.stdout.write(renderer.renderEnsureToLockLayerVersionsWarning())
        }
      }
    }

    this.context.stdout.write(renderer.renderWillApplyUpdates(this.dryRun))
    for (const config of configs) {
      if (config.updateRequest) {
        this.context.stdout.write(
          `UpdateFunctionConfiguration -> ${config.functionARN}\n${JSON.stringify(
            config.updateRequest,
            undefined,
            2
          )}\n`
        )
      }
      const {logGroupConfiguration, tagConfiguration} = config
      if (tagConfiguration?.tagResourceRequest) {
        this.context.stdout.write(
          `TagResource -> ${tagConfiguration.tagResourceRequest.Resource}\n${JSON.stringify(
            tagConfiguration.tagResourceRequest.Tags,
            undefined,
            2
          )}\n`
        )
      }
      if (logGroupConfiguration?.createLogGroupRequest) {
        this.context.stdout.write(
          `CreateLogGroup -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.createLogGroupRequest,
            undefined,
            2
          )}\n`
        )
      }
      if (logGroupConfiguration?.deleteSubscriptionFilterRequest) {
        this.context.stdout.write(
          `DeleteSubscriptionFilter -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.deleteSubscriptionFilterRequest,
            undefined,
            2
          )}\n`
        )
      }
      if (logGroupConfiguration?.subscriptionFilterRequest) {
        this.context.stdout.write(
          `PutSubscriptionFilter -> ${logGroupConfiguration.logGroupName}\n${JSON.stringify(
            logGroupConfiguration.subscriptionFilterRequest,
            undefined,
            2
          )}\n`
        )
      }
    }
  }

  private setEnvServiceVersion() {
    this.environment = process.env[ENVIRONMENT_ENV_VAR] || undefined
    this.service = process.env[SERVICE_ENV_VAR] || undefined
    this.version = process.env[VERSION_ENV_VAR] || undefined
  }

  private async uploadGitData() {
    const cli = new Cli()
    cli.register(UploadCommand)
    if ((await cli.run(['git-metadata', 'upload'], this.context)) !== 0) {
      throw Error("Couldn't upload git metadata")
    }

    return
  }
}

InstrumentCommand.addPath('lambda', 'instrument')
InstrumentCommand.addOption('functions', Command.Array('-f,--function'))
InstrumentCommand.addOption('regExPattern', Command.String('--functions-regex,--functionsRegex'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('extensionVersion', Command.String('-e,--extension-version,--extensionVersion'))
InstrumentCommand.addOption('layerVersion', Command.String('-v,--layer-version,--layerVersion'))
InstrumentCommand.addOption('layerAWSAccount', Command.String('-a,--layer-account,--layerAccount', {hidden: true}))
InstrumentCommand.addOption('tracing', Command.String('--tracing'))
InstrumentCommand.addOption('mergeXrayTraces', Command.String('--merge-xray-traces,--mergeXrayTraces'))
InstrumentCommand.addOption('flushMetricsToLogs', Command.String('--flush-metrics-to-logs,--flushMetricsToLogs'))
InstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
InstrumentCommand.addOption('configPath', Command.String('--config'))
InstrumentCommand.addOption('forwarder', Command.String('--forwarder'))
InstrumentCommand.addOption('logLevel', Command.String('--log-level,--logLevel'))

InstrumentCommand.addOption('service', Command.String('--service'))
InstrumentCommand.addOption('environment', Command.String('--env'))
InstrumentCommand.addOption('version', Command.String('--version'))
InstrumentCommand.addOption('extraTags', Command.String('--extra-tags,--extraTags'))
InstrumentCommand.addOption(
  'sourceCodeIntegration',
  Command.Boolean('-s,--source-code-integration,--sourceCodeIntegration')
)
InstrumentCommand.addOption('interactive', Command.Boolean('-i,--interactive'))
InstrumentCommand.addOption('captureLambdaPayload', Command.String('--capture-lambda-payload,--captureLambdaPayload'))
InstrumentCommand.addOption('profile', Command.String('--profile'))
