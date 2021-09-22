import { Command } from 'clipanion'

export class UninstrumentCommand extends Command {
    public async execute() {
        console.log('wow much uninstrument, so serverless!!!!1eleven')
    }
}

UninstrumentCommand.addPath('lambda', 'uninstrument')