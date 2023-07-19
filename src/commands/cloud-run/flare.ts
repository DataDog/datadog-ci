import IService = google.cloud.run.v2.IService
import process from 'process'
import util from 'util'

import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {GoogleAuth} from 'google-auth-library'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../constants'
import * as helpersRenderer from '../../helpers/renderer'

import {maskEnvVar} from '../lambda/functions/commons'

export class CloudRunFlareCommand extends Command {
  private isDryRun = false
  private service?: string
  private project?: string
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
    // Validate service
    if (this.service === undefined) {
      errorMessages.push(helpersRenderer.renderError('No service specified. [-s,--service]'))
    }

    // Validate project
    if (this.project === undefined) {
      errorMessages.push(helpersRenderer.renderError('No project specified. [-p,--project]'))
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

    // If there are errors, print them and exit
    if (errorMessages.length > 0) {
      for (const message of errorMessages) {
        this.context.stderr.write(message)
      }

      return 1
    }

    // Get GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    if (!(await checkAuthentication())) {
      this.context.stderr.write('\n' + helpersRenderer.renderError('Unable to authenticate with GCP.'))
      this.context.stdout.write('\nTo authenticate with GCP, please follow these steps:\n')
      this.context.stdout.write(
        "1. If you haven't already, install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install\n"
      )
      this.context.stdout.write(
        '2. Run "gcloud auth application-default login" and follow the prompts in your browser to log in.\n'
      )
      this.context.stdout.write('3. After logging in, run this program again.\n\n')

      return 1
    }
    this.context.stdout.write('GCP credentials verified!\n')

    // Get service configuration
    this.context.stdout.write(chalk.bold('\n🔍 Fetching service configuration...\n'))
    const runClient = new ServicesClient()
    let config: IService
    try {
      config = await getCloudRunServiceConfig(runClient, this.service!, this.project!, this.location!)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(`Unable to fetch service configuration: ${err.message}`))
      }

      return 1
    }
    maskConfig(config)
    const configStr = util.inspect(config, false, 10, true)
    this.context.stdout.write(`\n${configStr}\n`)

    return 0
  }
}

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
const checkAuthentication = async () => {
  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (err) {
    return false
  }
}

/**
 * Call the google-cloud run sdk to get the configuration
 * for the given service.
 * @param runClient the google-cloud run sdk client
 * @param serviceName the name of the service
 * @param projectName the project where the service is deployed
 * @param location the region where the service is deployed
 * @returns the configuration for the given service
 */
export const getCloudRunServiceConfig = async (
  runClient: ServicesClient,
  serviceName: string,
  projectName: string,
  location: string
) => {
  const request = {
    name: runClient.servicePath(projectName, location, serviceName),
  }

  const [response] = await runClient.getService(request)

  return response
}

/**
 * Mask the environment variables in a Cloud Run service configuration
 * @param config
 */
export const maskConfig = (config: IService) => {
  const environmentVariables = config.template?.containers?.[0]?.env

  if (!environmentVariables) {
    return
  }

  for (const envVar of environmentVariables) {
    const envName = envVar.name
    const envValue = envVar.value
    if (!envName || !envValue) {
      continue
    }

    envVar.value = maskEnvVar(envName, envValue)
  }
}

CloudRunFlareCommand.addPath('cloud-run', 'flare')
CloudRunFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
CloudRunFlareCommand.addOption('service', Command.String('-s,--service'))
CloudRunFlareCommand.addOption('project', Command.String('-p,--project'))
CloudRunFlareCommand.addOption('location', Command.String('-l,--location'))
CloudRunFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
CloudRunFlareCommand.addOption('email', Command.String('-e,--email'))
