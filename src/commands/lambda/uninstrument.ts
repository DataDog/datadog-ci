import {CloudWatchLogs, Lambda} from 'aws-sdk'
import {bold} from 'chalk'
import {Command} from 'clipanion'

import {resolveConfigFromFile} from '../../helpers/utils'

import {AWS_DEFAULT_REGION_ENV_VAR} from './constants'
import {
  collectFunctionsByRegion,
  getAllLambdaFunctionConfigs,
  isMissingAWSCredentials,
  updateAWSProfileCredentials,
  updateLambdaFunctionConfig,
  willUpdateFunctionConfigs,
} from './functions/commons'
import {getUninstrumentedFunctionConfigs, getUninstrumentedFunctionConfigsFromRegEx} from './functions/uninstrument'
import {FunctionConfiguration} from './interfaces'
import {requestAWSCredentials, requestChangesConfirmation, requestFunctionSelection} from './prompt'
import * as renderer from './renderer'

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
  private profile?: string
  private regExPattern?: string
  private region?: string

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
      } catch (e) {
        this.context.stdout.write(renderer.renderError(e))

        return 1
      }

      const region = this.region ?? this.config.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
      this.region = region

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
    }

    hasSpecifiedFunctions = this.functions.length !== 0 || this.config.functions.length !== 0
    const hasSpecifiedRegExPattern = this.regExPattern !== undefined && this.regExPattern !== ''
    if (!hasSpecifiedFunctions && !hasSpecifiedRegExPattern) {
      this.context.stdout.write(renderer.renderNoFunctionsSpecifiedError(Object.getPrototypeOf(this)))

      return 1
    }

    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
      region: string
    }[] = []

    // Fetch lambda function configurations that are
    // available to be un-instrumented.
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

      const region = this.region || this.config.region
      if (!region) {
        this.context.stdout.write(renderer.renderNoDefaultRegionSpecifiedError())

        return 1
      }

      const spinner = renderer.fetchingFunctionsSpinner()
      try {
        const cloudWatchLogs = new CloudWatchLogs({region})
        const lambda = new Lambda({region})
        spinner.start()
        const configs = await getUninstrumentedFunctionConfigsFromRegEx(
          lambda,
          cloudWatchLogs,
          this.regExPattern!,
          this.forwarder
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
        functionGroups = collectFunctionsByRegion(
          this.functions.length !== 0 ? this.functions : this.config.functions,
          this.region || this.config.region
        )
      } catch (err) {
        this.context.stdout.write(renderer.renderCouldntGroupFunctionsError(err))

        return 1
      }

      for (const [region, functionARNs] of Object.entries(functionGroups)) {
        const spinner = renderer.fetchingFunctionsConfigSpinner(region)
        spinner.start()
        const lambda = new Lambda({region})
        const cloudWatchLogs = new CloudWatchLogs({region})
        try {
          const configs = await getUninstrumentedFunctionConfigs(lambda, cloudWatchLogs, functionARNs, this.forwarder)
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
      this.context.stdout.write(renderer.renderUninstrumentingFunctionsSoftWarning())
    }

    // Un-instrument functions.
    if (willUpdate) {
      const totalFunctions = Object.values(configGroups).reduce((c, group) => (c += group.configs.length), 0)
      let totalFailedUpdates = 0
      for (const group of configGroups) {
        const spinner = renderer.updatingFunctionsConfigFromRegionSpinner(group.region, group.configs.length)
        spinner.start()
        const failedUpdates = []
        for (const config of group.configs) {
          try {
            await updateLambdaFunctionConfig(group.lambda, group.cloudWatchLogs, config)
          } catch (e) {
            failedUpdates.push({functionARN: config.functionARN, error: e})
            totalFailedUpdates += 1
          }
        }

        if (failedUpdates.length === group.configs.length) {
          spinner.fail(renderer.renderFailedUpdatingEveryLambdaFunctionFromRegion(group.region))
        } else if (failedUpdates.length > 0) {
          spinner.warn(
            renderer.renderUpdatedLambdaFunctionsFromRegion(group.region, group.configs.length - failedUpdates.length)
          )
          for (const failedUpdate of failedUpdates) {
            this.context.stdout.write(
              renderer.renderFailedUpdatingLambdaFunction(failedUpdate.functionARN, failedUpdate.error)
            )
          }
        }

        if (failedUpdates.length === 0) {
          spinner.succeed(renderer.renderUpdatedLambdaFunctionsFromRegion(group.region, group.configs.length))
        }
      }

      if (totalFunctions === totalFailedUpdates) {
        this.context.stdout.write(renderer.renderFailedUpdatingEveryLambdaFunction())

        return 1
      }

      if (totalFailedUpdates > 0) {
        this.context.stdout.write(
          renderer.renderSoftWarning(renderer.renderUpdatedLambdaFunctions(totalFunctions - totalFailedUpdates))
        )
      }

      if (!totalFailedUpdates) {
        this.context.stdout.write(renderer.renderSuccess(renderer.renderUpdatedLambdaFunctions(totalFunctions)))
      }
    }

    return 0
  }

  private printPlannedActions(configs: FunctionConfiguration[]) {
    const willUpdate = willUpdateFunctionConfigs(configs)

    if (!willUpdate) {
      this.context.stdout.write(renderer.renderNoUpdatesApplied(this.dryRun))

      return
    }

    this.context.stdout.write(renderer.renderFunctionsToBeUpdated())
    for (const config of configs) {
      this.context.stdout.write(`\t- ${bold(config.functionARN)}\n`)
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
UninstrumentCommand.addOption('regExPattern', Command.String('--functions-regex,--functionsRegex'))
UninstrumentCommand.addOption('interactive', Command.Boolean('-i,--interactive'))
UninstrumentCommand.addOption('profile', Command.String('--profile'))
/**
 * Commands that are not really in use, but to
 * make uninstrumentation easier for the user.
 */
UninstrumentCommand.addOption(
  'extensionVersion',
  Command.String('-e,--extension-version,--extensionVersion', {hidden: true})
)
UninstrumentCommand.addOption('layerVersion', Command.String('-v,--layer-version,--layerVersion', {hidden: true}))
UninstrumentCommand.addOption('tracing', Command.String('--tracing', {hidden: true}))
UninstrumentCommand.addOption(
  'mergeXrayTraces',
  Command.String('--merge-xray-traces,--mergeXrayTraces', {hidden: true})
)
UninstrumentCommand.addOption(
  'flushMetricsToLogs',
  Command.String('--flush-metrics-to-logs,--flushMetricsToLogs', {hidden: true})
)
UninstrumentCommand.addOption('logLevel', Command.String('--log-level,--logLevel', {hidden: true}))
UninstrumentCommand.addOption('service', Command.String('--service', {hidden: true}))
UninstrumentCommand.addOption('environment', Command.String('--env', {hidden: true}))
UninstrumentCommand.addOption('version', Command.String('--version', {hidden: true}))
UninstrumentCommand.addOption('extraTags', Command.String('--extra-tags,--extraTags', {hidden: true}))
UninstrumentCommand.addOption(
  'captureLambdaPayload',
  Command.String('--capture-lambda-payload,--captureLambdaPayload', {hidden: true})
)
