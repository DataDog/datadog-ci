import {Command} from 'clipanion'

import {renderLambdaFlareHeader} from './renderers/flare-renderer'

export class LambdaFlareCommand extends Command {
  private isDryRun = false

  public async execute() {
    this.context.stdout.write(renderLambdaFlareHeader(this.isDryRun))
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
