import { CloudWatchLogs, Lambda } from 'aws-sdk'
import { red } from 'chalk'
import { Command } from 'clipanion'
import { parseConfigFile } from '../../helpers/utils'
import { collectFunctionsByRegion, getLambdaFunctionConfigs } from './functions/commons'
import { uninstrumentLambdaFunctions } from './functions/uninstrument'

export class UninstrumentCommand extends Command {
  private config: any = {
    functions: [],
    region: process.env.AWS_DEFAULT_REGION,
  }
  private configPath?: string
  private dryRun = false
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
      configs: Lambda.FunctionConfiguration[]
      lambda: Lambda
      region: string
    }[] = []

    // Fetch lambda function configurations that are
    // available to be un-instrumented.
    for (const [region, functionList] of Object.entries(functionGroups)) {
      const lambda = new Lambda({region})
      const cloudWatchLogs = new CloudWatchLogs({region})
      try {
        const lambdaFunctionConfigs = await getLambdaFunctionConfigs(lambda, functionList)
        configGroups.push({configs: lambdaFunctionConfigs, cloudWatchLogs, lambda, region})
      } catch (err) {
        this.context.stdout.write(`${red('[Error]')} Couldn't fetch lambda functions. ${err}\n`)

        return 1
      }
    }

    // TODO: Print planned actions to be done.

    // Un-instrument functions.
    const promises = Object.values(configGroups).map(group => {

      uninstrumentLambdaFunctions(group.lambda, group.cloudWatchLogs, group.configs)
    })

    try {
      await Promise.all(promises)
    } catch (err) {
      this.context.stdout.write(`${red('[Error]')} Failure during un-instrumentation. ${err}`)

      return 1
    }

    return 0
  }
}

UninstrumentCommand.addPath('lambda', 'uninstrument')
UninstrumentCommand.addOption('functions', Command.Array('-f,--function'))
UninstrumentCommand.addOption('region', Command.String('-r,--region'))
UninstrumentCommand.addOption('configPath', Command.Array('--config'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
