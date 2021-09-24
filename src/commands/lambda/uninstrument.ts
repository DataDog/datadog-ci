import { CloudWatchLogs, Lambda } from 'aws-sdk'
import { Command } from 'clipanion'
import { parseConfigFile } from '../../helpers/utils'
import { getLambdaConfigs, getRegion } from './function'
import { FunctionConfiguration } from './interfaces'

export class UninstrumentCommand extends Command {
  private config: any = {
    functions: [],
    region: process.env.AWS_DEFAULT_REGION
  }
  private dryRun = false
  private functions: string[] = []
  private region?: string
  private configPath?: string

  public async execute() {
    const lambdaConfig = {lambda: this.config}
    this.config = (await parseConfigFile(lambdaConfig, this.configPath)).lambda
    
    const hasSpecifiedFuntions = this.functions.length !== 0 || this.config.functions.length !== 0
    if (!hasSpecifiedFuntions) {
      this.context.stdout.write('No functions specified for un-instrumentation.\n')

      return 1
    }    

    const functionGroups = this.collectFunctionsByRegion(this.functions.length !== 0 ? this.functions : this.config.functions)
    if (functionGroups === undefined) {
      return 1
    }
    
    const configGroups: {
      cloudWatchLogs: CloudWatchLogs
      configs: FunctionConfiguration[]
      lambda: Lambda
      region: string
    }[] = []

    
  }

  private collectFunctionsByRegion(functions: string[]) {
    const defaultRegion = this.region || this.config.region
    const groups: {[key: string]: string[]} = {}
    const regionless: string[] = []
    for (const func of functions) {
      const region = getRegion(func) ?? defaultRegion
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
}

UninstrumentCommand.addPath('lambda', 'uninstrument')
UninstrumentCommand.addOption('functions', Command.Array('-f,--function'))
UninstrumentCommand.addOption('region', Command.String('-r,--region'))
UninstrumentCommand.addOption('configPath', Command.Array('--config'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
