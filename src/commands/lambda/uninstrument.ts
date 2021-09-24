import { Command } from 'clipanion'
import { LambdaConfigOptions } from './interfaces'

export class UninstrumentCommand extends Command {
    private config: LambdaConfigOptions = {
        functions: [],
        region: process.env.AWS_DEFAULT_REGION,
    }

    private dryRun = false
    private functions: string[] = []
    private region?: string

    public async execute() {
        console.log('wow much uninstrument, so serverless!!!!1eleven')
    }
}

UninstrumentCommand.addPath('lambda', 'uninstrument')
UninstrumentCommand.addOption('functions', Command.Array('-f,--function'))
UninstrumentCommand.addOption('region', Command.String('-r,--region'))
UninstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
