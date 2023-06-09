import {Command} from 'clipanion'

import {renderError, renderLambdaFlareHeader} from './renderers/flare-renderer'

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private isInteractive = false
  // private allFunctions = false
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

    if (!this.validateCommand()) {
      return 1
    }

    return 0
  }

  /**
   * @returns true if the command is valid, false otherwise.
   * Prints an error message if the command is invalid.
   */
  private validateCommand = () => {
    if (this.isInteractive) {
      return true
    } else if (this.functions.length === 0) {
      this.context.stdout.write(renderError('No functions specified. [-f,--function]'))
    } else if (this.region === undefined) {
      this.context.stdout.write(renderError('No region specified. [-r,--region]'))
    } else if (this.apiKey === undefined) {
      this.context.stdout.write(renderError('No API key specified. [--api-key]'))
    } else if (this.email === undefined) {
      this.context.stdout.write(renderError('No email specified. [-e,--email]'))
    } else {
      return true
    }

    return false
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('isInteractive', Command.Boolean('-i,--interactive'))
// LambdaFlareCommand.addOption('allFunctions', Command.Boolean('--all-functions'))
LambdaFlareCommand.addOption('functions', Command.Array('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('apiKey', Command.String('--api-key'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
