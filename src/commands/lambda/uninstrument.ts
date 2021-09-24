import { Command } from 'clipanion'
import { parseConfigFile } from '../../helpers/utils'

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
  }
}

UninstrumentCommand.addPath('lambda', 'uninstrument')
UninstrumentCommand.addOption('functions', Command.Array('-f,--function'))
UninstrumentCommand.addOption('region', Command.String('-r,--region'))
UninstrumentCommand.addOption('configPath', Command.Array('--config'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
