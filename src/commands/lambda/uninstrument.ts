import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {bold, cyan, red, yellow} from 'chalk'
import {Command} from 'clipanion'
import {parseConfigFile} from '../../helpers/utils'
import {AWS_DEFAULT_REGION_ENV_VAR} from './constants'
import {
  collectFunctionsByRegion,
  getAllLambdaFunctionConfigs,
  isMissingAWSCredentials,
  updateLambdaFunctionConfigs,
  willUpdateFunctionConfigs,
} from './functions/commons'
import {getUninstrumentedFunctionConfigs, getUninstrumentedFunctionConfigsFromRegEx} from './functions/uninstrument'
import {FunctionConfiguration} from './interfaces'
import {requestAWSCredentials, requestChangesConfirmation, requestFunctionSelection} from './prompt'

export class UninstrumentCommand extends Command {
  private config: any = {
    functions: [],
    region: process.env[AWS_DEFAULT_REGION_ENV_VAR],
  }
  private configPath?: string
  private dryRun = false
  private forwarder?: string
  private functions: string[] = []
  private interactive = false
  private regExPattern?: string
  private region?: string

  public async execute() {
    const lambdaConfig = {lambda: this.config}
    this.config = (await parseConfigFile(lambdaConfig, this.configPath)).lambda

    let hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (this.interactive) {
      try {
        if (isMissingAWSCredentials()) {
          this.context.stdout.write(`${bold(yellow('[!]'))} No existing AWS credentials found, let's set them up!\n`)
          await requestAWSCredentials()
        }
      } catch (e) {
        this.context.stdout.write(`${red('[Error]')} ${e}\n`)

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      this.region = region

      if (!hasSpecifiedFunctions) {
        try {
          const lambda = new Lambda({region})
          this.context.stdout.write('Fetching Lambda functions, this might take a while.\n')
          const functionNames =
            (await getAllLambdaFunctionConfigs(lambda)).map((config) => config.FunctionName!).sort() ?? []
          if (functionNames.length === 0) {
            this.context.stdout.write(`${red('[Error]')} Couldn't find any Lambda functions in the specified region.\n`)

            return 1
          }
          const functions = await requestFunctionSelection(functionNames)
          this.functions = functions
        } catch (err) {
          this.context.stdout.write(`${red('[Error]')} Couldn't fetch Lambda functions. ${err}\n`)

          return 1
        }
      }
    }

    hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write('No functions specified for un-instrumentation.\n')

      return 1
    }

    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
    }[] = []

    // Fetch lambda function configurations that are
    // available to be un-instrumented.
    if (hasSpecifiedRegExPattern) {
      if (hasSpecifiedFunctions) {
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
        this.context.stdout.write('Fetching Lambda functions, this might take a while.\n')
        const configs = await getUninstrumentedFunctionConfigsFromRegEx(
          lambda,
          cloudWatchLogs,
          this.regExPattern!,
          this.forwarder!
        )

        configGroups.push({configs, lambda, cloudWatchLogs})
      } catch (err) {
        this.context.stdout.write(`${red('[Error]')} Couldn't fetch Lambda functions. ${err}\n`)

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

      for (const [region, functionARNs] of Object.entries(functionGroups)) {
        const lambda = new Lambda({region})
        const cloudWatchLogs = new CloudWatchLogs({region})
        try {
          const configs = await getUninstrumentedFunctionConfigs(lambda, cloudWatchLogs, functionARNs, this.forwarder)
          configGroups.push({configs, lambda, cloudWatchLogs})
        } catch (err) {
          this.context.stdout.write(`${red('[Error]')} Couldn't fetch Lambda functions. ${err}\n`)

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
      this.context.stdout.write(`${yellow('[!]')} Confirmation needed.\n`)
      const isConfirmed = await requestChangesConfirmation('Do you want to apply the changes?')
      if (!isConfirmed) {
        return 0
      }
      this.context.stdout.write(`${yellow('[!]')} Uninstrumenting functions.\n`)
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
    const prefix = this.dryRun ? bold(cyan('[Dry Run] ')) : ''

    const willUpdate = willUpdateFunctionConfigs(configs)

    if (!willUpdate) {
      this.context.stdout.write(`${prefix}No updates will be applied\n`)

      return
    }

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
UninstrumentCommand.addOption('configPath', Command.String('--config'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
UninstrumentCommand.addOption('forwarder', Command.String('--forwarder'))
UninstrumentCommand.addOption('regExPattern', Command.String('--functions-regex'))
UninstrumentCommand.addOption('interactive', Command.Boolean('-i,--interactive'))
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
UninstrumentCommand.addOption('captureLambdaPayload', Command.String('--capture-lambda-payload', {hidden: true}))
