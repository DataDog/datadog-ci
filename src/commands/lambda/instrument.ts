import {Lambda} from 'aws-sdk'
import {Command} from 'clipanion'
import {getLambdaConfig} from './function'

export class InstrumentCommand extends Command {
  private functions: string[] = []
  private region?: string

  public async execute() {
    if (this.functions.length === 0) {
      this.context.stdout.write('No functions specified for implementation.\n')
    }
    const lambda = new Lambda({region: this.region})
    for (const func of this.functions) {
      getLambdaConfig(lambda, func)
    }

    return 0
  }
}

InstrumentCommand.addPath('lambda', 'instrument')
InstrumentCommand.addOption('functions', Command.Array('-f,--function'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('forwarder', Command.String('--forwarder'))
