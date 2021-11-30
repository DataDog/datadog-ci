import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {blueBright, bold, cyan, hex, underline, yellow} from 'chalk'
import {Cli, Command} from 'clipanion'
import {parseConfigFile} from '../../helpers/utils'
import {getCommitInfo, newSimpleGit} from '../git-metadata/git'
import {UploadCommand} from '../git-metadata/upload'
import {EXTRA_TAGS_REG_EXP} from './constants'
import {
  coerceBoolean,
  collectFunctionsByRegion,
  sentenceMatchesRegEx,
  updateLambdaFunctionConfigs,
} from './functions/commons'
import {getInstrumentedFunctionConfigs, getInstrumentedFunctionConfigsFromRegEx} from './functions/instrument'
import {FunctionConfiguration, InstrumentationSettings, LambdaConfigOptions} from './interfaces'

export class InstrumentCommand extends Command {
  private config: LambdaConfigOptions = {
    functions: [],
    region: process.env.AWS_DEFAULT_REGION,
    tracing: 'true',
  }
  private captureLambdaPayload?: string
  private configPath?: string
  private dryRun = false
  private environment?: string
  private extensionVersion?: string
  private extraTags?: string
  private flushMetricsToLogs?: string
  private forwarder?: string
  private functions: string[] = []
  private layerAWSAccount?: string
  private layerVersion?: string
  private logLevel?: string
  private mergeXrayTraces?: string
  private regExPattern?: string
  private region?: string
  private service?: string
  private sourceCodeIntegration = false
  private tracing?: string
  private version?: string

  public async execute() {
    const lambdaConfig = {lambda: this.config}
    this.config = (await parseConfigFile(lambdaConfig, this.configPath)).lambda

    const settings = this.getSettings()
    if (settings === undefined) {
      return 1
    }

    const hasSpecifiedFuntions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFuntions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write('No functions specified for instrumentation.\n')

      return 1
    }
    if (settings.extensionVersion && settings.forwarderARN) {
      this.context.stdout.write('"extensionVersion" and "forwarder" should not be used at the same time.\n')

      return 1
    }

    if (this.sourceCodeIntegration) {
      if (!process.env.DATADOG_API_KEY) {
        this.context.stdout.write('Missing DATADOG_API_KEY in your environment\n')

        return 1
      }
      try {
        await this.getGitDataAndUpload(settings)
      } catch (err) {
        this.context.stdout.write(`${err}\n`)

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
      if (hasSpecifiedFuntions) {
        const usedCommand = this.functions.length !== 0 ? '"--functions"' : 'Functions in config file'
        this.context.stdout.write(`${usedCommand} and "--functions-regex" should not be used at the same time.\n`)

        return 1
      }
      if (this.regExPattern!.match(':')) {
        this.context.stdout.write(`"--functions-regex" isn't meant to be used with ARNs.\n`)

        return 1
      }

      const region = this.region || this.config.region
      if (!region) {
        this.context.stdout.write('No default region specified. Use `-r`, `--region`.')

        return 1
      }

      try {
        const cloudWatchLogs = new CloudWatchLogs({region})
        const lambda = new Lambda({region})
        this.context.stdout.write('Fetching lambda functions, this might take a while.\n')
        const configs = await getInstrumentedFunctionConfigsFromRegEx(
          lambda,
          cloudWatchLogs,
          region!,
          this.regExPattern!,
          settings
        )

        configGroups.push({configs, lambda, cloudWatchLogs, region: region!})
      } catch (err) {
        this.context.stdout.write(`Couldn't fetch lambda functions. ${err}\n`)

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
        this.context.stdout.write(`Couldn't group functions. ${err}`)

        return 1
      }

      for (const [region, functionList] of Object.entries(functionGroups)) {
        const lambda = new Lambda({region})
        const cloudWatchLogs = new CloudWatchLogs({region})
        try {
          const configs = await getInstrumentedFunctionConfigs(lambda, cloudWatchLogs, region, functionList, settings)
          configGroups.push({configs, lambda, cloudWatchLogs, region})
        } catch (err) {
          this.context.stdout.write(`Couldn't fetch lambda functions. ${err}\n`)

          return 1
        }
      }
    }

    const configList = configGroups.map((group) => group.configs).reduce((a, b) => a.concat(b))
    this.printPlannedActions(configList)
    if (this.dryRun || configList.length === 0) {
      return 0
    }

    const promises = Object.values(configGroups).map((group) =>
      updateLambdaFunctionConfigs(group.lambda, group.cloudWatchLogs, group.configs)
    )
    try {
      await Promise.all(promises)
    } catch (err) {
      this.context.stdout.write(`Failure during update. ${err}\n`)

      return 1
    }

    return 0
  }

  private async getCurrentGitStatus() {
    const simpleGit = await newSimpleGit()
    const gitCommitInfo = await getCommitInfo(simpleGit, this.context.stdout)
    if (gitCommitInfo === undefined) {
      throw new Error('Git commit info is not defined')
    }
    const status = await simpleGit.status()

    return {isClean: status.isClean(), ahead: status.ahead, files: status.files, hash: gitCommitInfo?.hash}
  }

  private async getGitDataAndUpload(settings: InstrumentationSettings) {
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

    const commitSha = currentStatus.hash
    if (settings.extraTags) {
      settings.extraTags += `,git.commit.sha:${commitSha}`
    } else {
      settings.extraTags = `git.commit.sha:${commitSha}`
    }

    try {
      await this.uploadGitData()
    } catch (err) {
      throw Error(`Error uploading git data: ${err}\n`)
    }
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
      this.context.stdout.write(`Invalid layer version ${layerVersion}.\n`)

      return
    }

    let extensionVersion: number | undefined
    if (extensionVersionStr !== undefined) {
      extensionVersion = parseInt(extensionVersionStr, 10)
    }
    if (Number.isNaN(extensionVersion)) {
      this.context.stdout.write(`Invalid extension version ${extensionVersion}.\n`)

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
        this.context.stdout.write(`Invalid boolean specified for ${stringBoolean}.\n`)

        return
      }
    }

    const captureLambdaPayload = coerceBoolean(false, this.captureLambdaPayload, this.config.captureLambdaPayload)
    const flushMetricsToLogs = coerceBoolean(true, this.flushMetricsToLogs, this.config.flushMetricsToLogs)
    const mergeXrayTraces = coerceBoolean(false, this.mergeXrayTraces, this.config.mergeXrayTraces)
    const tracingEnabled = coerceBoolean(true, this.tracing, this.config.tracing)
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
      const tags = tagsMissing.join(', ').replace(/, ([^,]*)$/, ' and $1')
      const plural = tagsMissing.length > 1
      this.context.stdout.write(
        `${bold(yellow('[Warning]'))} The ${tags} tag${
          plural ? 's have' : ' has'
        } not been configured. Learn more about Datadog unified service tagging: ${underline(
          blueBright(
            'https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.'
          )
        )}\n`
      )
    }

    const extraTags = this.extraTags?.toLowerCase() ?? this.config.extraTags?.toLowerCase()
    if (extraTags && !sentenceMatchesRegEx(extraTags, EXTRA_TAGS_REG_EXP)) {
      this.context.stdout.write('Extra tags do not comply with the <key>:<value> array.\n')

      return
    }

    return {
      captureLambdaPayload,
      environment,
      extensionVersion,
      extraTags,
      flushMetricsToLogs,
      forwarderARN,
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
    const prefix = this.dryRun ? bold(cyan('[Dry Run] ')) : ''

    let anyUpdates = false
    for (const config of configs) {
      if (
        config.updateRequest !== undefined ||
        config.logGroupConfiguration?.createLogGroupRequest !== undefined ||
        config.logGroupConfiguration?.deleteSubscriptionFilterRequest !== undefined ||
        config.logGroupConfiguration?.subscriptionFilterRequest !== undefined ||
        config?.tagConfiguration !== undefined
      ) {
        anyUpdates = true
        break
      }
    }
    if (!anyUpdates) {
      this.context.stdout.write(`\n${prefix}No updates will be applied\n`)

      return
    }
    this.context.stdout.write(
      `${bold(yellow('[Warning]'))} Instrument your ${hex('#FF9900').bold(
        'Lambda'
      )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
        'uninstrument'
      )}\` with the same arguments to revert the changes.\n`
    )

    this.context.stdout.write(`\n${bold(yellow('[!]'))} Functions to be updated:\n`)
    for (const config of configs) {
      this.context.stdout.write(`\t- ${bold(config.functionARN)}\n`)
    }

    this.context.stdout.write(`\n${prefix}Will apply the following updates:\n`)
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
InstrumentCommand.addOption('regExPattern', Command.String('--functions-regex'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('extensionVersion', Command.String('-e,--extensionVersion'))
InstrumentCommand.addOption('layerVersion', Command.String('-v,--layerVersion'))
InstrumentCommand.addOption('layerAWSAccount', Command.String('-a,--layerAccount', {hidden: true}))
InstrumentCommand.addOption('tracing', Command.String('--tracing'))
InstrumentCommand.addOption('mergeXrayTraces', Command.String('--mergeXrayTraces'))
InstrumentCommand.addOption('flushMetricsToLogs', Command.String('--flushMetricsToLogs'))
InstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
InstrumentCommand.addOption('configPath', Command.String('--config'))
InstrumentCommand.addOption('forwarder', Command.String('--forwarder'))
InstrumentCommand.addOption('logLevel', Command.String('--logLevel'))

InstrumentCommand.addOption('service', Command.String('--service'))
InstrumentCommand.addOption('environment', Command.String('--env'))
InstrumentCommand.addOption('version', Command.String('--version'))
InstrumentCommand.addOption('extraTags', Command.String('--extra-tags'))
InstrumentCommand.addOption('sourceCodeIntegration', Command.Boolean('-s,--source-code-integration'))
InstrumentCommand.addOption('captureLambdaPayload', Command.String('--capture-lambda-payload'))
