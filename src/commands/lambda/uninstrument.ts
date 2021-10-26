import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {cyan, red} from 'chalk'
import {Command} from 'clipanion'
import {parseConfigFile} from '../../helpers/utils'
import {collectFunctionsByRegion, updateLambdaFunctionConfigs} from './functions/commons'
import {getFunctionConfigs} from './functions/uninstrument'
import {FunctionConfiguration} from './interfaces'

export class UninstrumentCommand extends Command {
  private config: any = {
    functions: [],
    region: process.env.AWS_DEFAULT_REGION,
  }
  private configPath?: string
  private dryRun = false
  private forwarder?: string
  private functions: string[] = []
  private region?: string

  public async execute() {
    const lambdaConfig = {lambda: this.config}
    this.config = (await parseConfigFile(lambdaConfig, this.configPath)).lambda

    const hasSpecifiedFuntions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (!hasSpecifiedFuntions) {
      this.context.stdout.write('No functions specified for un-instrumentation.\n')

      return 1
    }

    const functionGroups = collectFunctionsByRegion(
      this.functions.length !== 0 ? this.functions : this.config.functions,
      this.region || this.config.region
    )
    if (functionGroups === undefined) {
      return 1
    }

    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
    }[] = []

    // Fetch lambda function configurations that are
    // available to be un-instrumented.
    for (const [region, functionList] of Object.entries(functionGroups)) {
      const lambda = new Lambda({region})
      const cloudWatchLogs = new CloudWatchLogs({region})
      try {
        const configs = await getFunctionConfigs(lambda, cloudWatchLogs, functionList, this.forwarder)
        configGroups.push({configs, lambda, cloudWatchLogs})
      } catch (err) {
        this.context.stdout.write(`${red('[Error]')} Couldn't fetch lambda functions. ${err}\n`)

        return 1
      }
    }

    const configList = configGroups.map((group) => group.configs).reduce((a, b) => a.concat(b))
    this.printPlannedActions(configList)
    if (this.dryRun || configList.length === 0) {
      return 0
    }

    // Un-instrument functions.
    const promises = Object.values(configGroups).map((group) => {
      updateLambdaFunctionConfigs(group.lambda, group.cloudWatchLogs, group.configs)
    })

    try {
      await Promise.all(promises)
    } catch (err) {
      this.context.stdout.write(`${red('[Error]')} Failure during un-instrumentation. ${err}`)

      return 1
    }

    return 0
  }

  private printPlannedActions(configs: FunctionConfiguration[]) {
    const prefix = this.dryRun ? cyan('[Dry Run] ') : ''

    let anyUpdates = false
    for (const config of configs) {
      if (
        config.updateRequest !== undefined ||
        config.logGroupConfiguration?.deleteSubscriptionFilterRequest !== undefined ||
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
      if (tagConfiguration?.untagResourceRequest) {
        this.context.stdout.write(
          `UntagResource -> ${tagConfiguration.untagResourceRequest.Resource}\n${JSON.stringify(
            tagConfiguration.untagResourceRequest.TagKeys,
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
    }
  }
}

UninstrumentCommand.addPath('lambda', 'uninstrument')
UninstrumentCommand.addOption('functions', Command.Array('-f,--function'))
UninstrumentCommand.addOption('region', Command.String('-r,--region'))
UninstrumentCommand.addOption('configPath', Command.Array('--config'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
UninstrumentCommand.addOption('forwarder', Command.String('--forwarder'))

/**
 * Commands that are not really in use, but to
 * make uninstrumentation easier for the user.
 */
UninstrumentCommand.addOption('extensionVersion', Command.String('-e,--extensionVersion', {hidden: true}))
UninstrumentCommand.addOption('layerVersion', Command.String('-v,--layerVersion', {hidden: true}))
UninstrumentCommand.addOption('tracing', Command.String('--tracing', {hidden: true}))
UninstrumentCommand.addOption('mergeXrayTraces', Command.String('--mergeXrayTraces', {hidden: true}))
UninstrumentCommand.addOption('flushMetricsToLogs', Command.String('--flushMetricsToLogs', {hidden: true}))
UninstrumentCommand.addOption('logLevel', Command.String('--logLevel', {hidden: true}))
UninstrumentCommand.addOption('service', Command.String('--service', {hidden: true}))
UninstrumentCommand.addOption('environment', Command.String('--env', {hidden: true}))
UninstrumentCommand.addOption('version', Command.String('--version', {hidden: true}))
UninstrumentCommand.addOption('extraTags', Command.String('--extra-tags', {hidden: true}))
