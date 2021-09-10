import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {Command} from 'clipanion'
import {parseConfigFile} from '../../helpers/utils'
import {FunctionConfiguration, getLambdaConfigs, InstrumentationSettings, updateLambdaConfigs} from './function'
import {LambdaConfigOptions} from './interfaces'

export class InstrumentCommand extends Command {
  private config: LambdaConfigOptions = {
    functions: [],
    region: process.env.AWS_DEFAULT_REGION,
    tracing: 'true',
  }
  private configPath?: string
  private dryRun = false
  private extensionVersion?: string
  private flushMetricsToLogs?: string
  private forwarder?: string
  private functions: string[] = []
  private layerAWSAccount?: string
  private layerVersion?: string
  private logLevel?: string
  private mergeXrayTraces?: boolean
  private region?: string
  private tracing?: string

  public async execute() {
    const lambdaConfig = {lambda: this.config}
    this.config = (await parseConfigFile(lambdaConfig, this.configPath)).lambda

    const settings = this.getSettings()
    if (settings === undefined) {
      return 1
    }

    const hasSpecifiedFuntions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (!hasSpecifiedFuntions) {
      this.context.stdout.write('No functions specified for instrumentation.\n')

      return 1
    }

    const functionGroups = this.collectFunctionsByRegion()
    if (functionGroups === undefined) {
      return 1
    }

    if (settings.extensionVersion && settings.forwarderARN) {
      this.context.stdout.write('"extensionVersion" and "forwarder" should not be used at the same time.\n')

      return 1
    }

    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
      region: string
    }[] = []

    for (const [region, functionList] of Object.entries(functionGroups)) {
      const lambda = new Lambda({region})
      const cloudWatchLogs = new CloudWatchLogs({region})
      try {
        const configs = await getLambdaConfigs(lambda, cloudWatchLogs, region, functionList, settings)
        configGroups.push({configs, lambda, cloudWatchLogs, region})
      } catch (err) {
        this.context.stdout.write(`Couldn't fetch lambda functions. ${err}\n`)

        return 1
      }
    }

    const configList = configGroups.map((group) => group.configs).reduce((a, b) => a.concat(b))
    this.printPlannedActions(configList)
    if (this.dryRun || configList.length === 0) {
      return 0
    }

    const promises = Object.values(configGroups).map((group) =>
      updateLambdaConfigs(group.lambda, group.cloudWatchLogs, group.configs)
    )
    try {
      await Promise.all(promises)
    } catch (err) {
      this.context.stdout.write(`Failure during update. ${err}\n`)

      return 1
    }

    return 0
  }

  private collectFunctionsByRegion() {
    const functions = this.functions.length !== 0 ? this.functions : this.config.functions
    const defaultRegion = this.region || this.config.region
    const groups: {[key: string]: string[]} = {}
    const regionless: string[] = []
    for (const func of functions) {
      const region = this.getRegion(func) ?? defaultRegion
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
      this.context.stdout.write(
        `'No default region specified for ${JSON.stringify(regionless)}. Use -r,--region, or use a full functionARN\n`
      )

      return
    }

    return groups
  }

  private getRegion(functionARN: string) {
    const [, , , region] = functionARN.split(':')

    return region === undefined || region === '*' ? undefined : region
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

    if (!['true', 'false', undefined].includes(this.flushMetricsToLogs?.toLowerCase())) {
      this.context.stdout.write('No valid value specified for flushMetricsToLogs.\n')

      return
    }

    if (!['true', 'false', undefined].includes(this.tracing?.toLowerCase())) {
      this.context.stdout.write('No valid value specified for tracing.\n')

      return
    }

    const flushMetricsToLogs = this.convertStringBooleanToBoolean(true, this.flushMetricsToLogs, this.config.flushMetricsToLogs)
    const mergeXrayTraces = this.mergeXrayTraces ?? this.config.mergeXrayTraces ?? false
    const tracingEnabled = this.convertStringBooleanToBoolean(true, this.tracing, this.config.tracing)
    const logLevel = this.logLevel ?? this.config.logLevel

    return {
      extensionVersion,
      flushMetricsToLogs,
      forwarderARN,
      layerAWSAccount,
      layerVersion,
      logLevel,
      mergeXrayTraces,
      tracingEnabled,
    }
  }

  private printPlannedActions(configs: FunctionConfiguration[]) {
    const prefix = this.dryRun ? '[Dry Run] ' : ''

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
      this.context.stdout.write(`${prefix}No updates will be applied\n`)

      return
    }
    this.context.stdout.write(`${prefix}Will apply the following updates:\n`)
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

  private convertStringBooleanToBoolean(fallback: boolean, value?: string, configValue?: string): boolean {
    return value
    ? value.toLowerCase() === 'true'
    : configValue
    ? configValue.toLowerCase() === 'true'
    : fallback
  }
}

InstrumentCommand.addPath('lambda', 'instrument')
InstrumentCommand.addOption('functions', Command.Array('-f,--function'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('extensionVersion', Command.String('-e,--extensionVersion'))
InstrumentCommand.addOption('layerVersion', Command.String('-v,--layerVersion'))
InstrumentCommand.addOption('layerAWSAccount', Command.String('-a,--layerAccount', {hidden: true}))
InstrumentCommand.addOption('tracing', Command.String('--tracing'))
InstrumentCommand.addOption('mergeXrayTraces', Command.Boolean('--mergeXrayTraces'))
InstrumentCommand.addOption('flushMetricsToLogs', Command.String('--flushMetricsToLogs'))
InstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
InstrumentCommand.addOption('configPath', Command.String('--config'))
InstrumentCommand.addOption('forwarder', Command.String('--forwarder'))
InstrumentCommand.addOption('logLevel', Command.String('--logLevel'))
