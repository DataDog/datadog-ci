import {Command} from 'clipanion'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../constants'
import * as helpersRenderer from '../../helpers/renderer'

export class CloudRunFlareCommand extends Command {
  private isDryRun = false
  private serviceId?: string
  private projectId?: string
  private location?: string
  private caseId?: string
  private email?: string
  private apiKey?: string

  /**
   * Entry point for the `cloud-run flare` command.
   * Gathers Cloud Run service configuration and sends it to Datadog.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute() {
    this.context.stdout.write(helpersRenderer.renderFlareHeader('Cloud Run', this.isDryRun))

    const errorMessages: string[] = []
    // Validate service ID
    if (this.serviceId === undefined) {
      errorMessages.push(helpersRenderer.renderError('No service ID specified. [-s,--service-id]'))
    }

    // Validate project ID
    if (this.projectId === undefined) {
      errorMessages.push(helpersRenderer.renderError('No project ID specified. [-p,--project-id]'))
    }

    // Validate location
    if (this.location === undefined) {
      errorMessages.push(helpersRenderer.renderError('No location specified. [-l,--location]'))
    }

    // Validate Datadog API key
    this.apiKey = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      errorMessages.push(
        helpersRenderer.renderError(
          'No Datadog API key specified. Set an API key with the DATADOG_API_KEY environment variable.'
        )
      )
    }

    // Validate case ID
    if (this.caseId === undefined) {
      errorMessages.push(helpersRenderer.renderError('No case ID specified. [-c,--case-id]'))
    }

    // Validate email
    if (this.email === undefined) {
      errorMessages.push(helpersRenderer.renderError('No email specified. [-e,--email]'))
    }

    if (errorMessages.length > 0) {
      for (const message of errorMessages) {
        this.context.stderr.write(message)
      }

      return 1
    }

    return 0
  }
}

CloudRunFlareCommand.addPath('cloud-run', 'flare')
CloudRunFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
CloudRunFlareCommand.addOption('serviceId', Command.String('-s,--service-id'))
CloudRunFlareCommand.addOption('projectId', Command.String('-p,--project-id'))
CloudRunFlareCommand.addOption('location', Command.String('-l,--location'))
CloudRunFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
CloudRunFlareCommand.addOption('email', Command.String('-e,--email'))
