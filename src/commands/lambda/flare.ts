import {Command} from 'clipanion'

import {validateFlags} from './flare-command-validator'
import {renderError, renderLambdaFlareHeader} from './renderers/flare-renderer'

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private isInteractive = false
  private functions: string[] = []
  private region?: string
  private apiKey?: string
  private caseId?: string
  private email?: string

  /**
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute() {
    this.context.stdout.write(renderLambdaFlareHeader(this.isDryRun))

    const errors = validateFlags(this)
    if (errors) {
      this.context.stdout.write(renderError(errors))

      return 1
    }

    return 0
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('isInteractive', Command.Boolean('-i,--interactive'))
LambdaFlareCommand.addOption('functions', Command.Array('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('apiKey', Command.String('--api-key'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
