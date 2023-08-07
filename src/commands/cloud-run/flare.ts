import IService = google.cloud.run.v2.IService
import fs from 'fs'
import path from 'path'
import process from 'process'
import util from 'util'

import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {GoogleAuth} from 'google-auth-library'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR, FLARE_OUTPUT_DIRECTORY, INSIGHTS_FILE_NAME} from '../../constants'
import {sendToDatadog} from '../../helpers/flare'
import {createDirectories, deleteFolder, writeFile, zipContents} from '../../helpers/fs'
import {requestConfirmation} from '../../helpers/prompt'
import * as helpersRenderer from '../../helpers/renderer'
import {maskString} from '../../helpers/utils'

import {SKIP_MASKING_CLOUDRUN_ENV_VARS} from './constants'
import {renderAuthenticationInstructions} from './renderer'

const version = require('../../../package.json').version

const SERVICE_CONFIG_FILE_NAME = 'service_config.json'
const FLARE_ZIP_FILE_NAME = 'cloudrun-flare-output.zip'

export class CloudRunFlareCommand extends Command {
  private isDryRun = false
  private service?: string
  private project?: string
  private region?: string
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

    // Validate region
    if (this.region === undefined) {
      errorMessages.push(helpersRenderer.renderError('No region specified. [-r,--region]'))
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

    // Verify GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    const authenticated = await checkAuthentication()
    if (!authenticated) {
      this.context.stderr.write(renderAuthenticationInstructions())

      return 1
    }
    this.context.stdout.write('GCP credentials verified!\n')

    // Get and print service configuration
    this.context.stdout.write(chalk.bold('\n🔍 Fetching service configuration...\n'))
    const runClient = new ServicesClient()
    let config: IService
    try {
      config = await getCloudRunServiceConfig(runClient, this.service!, this.project!, this.region!)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(`Unable to fetch service configuration: ${err.message}`))
      }

      return 1
    }
    config = maskConfig(config)
    // 10 is the depth when inspecting the config file. Cloud-run configs have high depth, so
    // we must raise the depth from the default depth of 2.
    const configStr = util.inspect(config, false, 10, true)
    this.context.stdout.write(`\n${configStr}\n`)

    // Save and zip service configuration
    this.context.stdout.write(chalk.bold('\n💾 Saving configuration...\n'))
    const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
    try {
      // Delete folder if it already exists
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }

      // Create folder
      createDirectories(rootFolderPath, [])

      // Write file
      const configFilePath = path.join(rootFolderPath, SERVICE_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))

      // Write insights file
      try {
        const insightsFilePath = path.join(rootFolderPath, INSIGHTS_FILE_NAME)
        generateInsightsFile(insightsFilePath, this.isDryRun, config)
        this.context.stdout.write(`• Saved insights file to ./${INSIGHTS_FILE_NAME}\n`)
      } catch (err) {
        const errorDetails = err instanceof Error ? err.message : ''
        this.context.stdout.write(
          helpersRenderer.renderSoftWarning(`Unable to create INSIGHTS.md file. ${errorDetails}`)
        )
      }

      // Exit if dry run
      const outputMsg = `\nℹ️ Your output files are located at: ${rootFolderPath}\n\n`
      if (this.isDryRun) {
        this.context.stdout.write('\n🚫 The flare files were not sent as it was executed in dry run mode.')
        this.context.stdout.write(outputMsg)

        return 0
      }

      // Confirm before sending
      this.context.stdout.write('\n')
      let confirmSendFiles
      try {
        confirmSendFiles = await requestConfirmation(
          'Are you sure you want to send the flare file to Datadog Support?',
          false
        )
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(helpersRenderer.renderError(err.message))
        }

        return 1
      }
      if (!confirmSendFiles) {
        this.context.stdout.write('\n🚫 The flare files were not sent based on your selection.')
        this.context.stdout.write(outputMsg)

        return 0
      }

      // Zip folder
      const zipPath = path.join(rootFolderPath, FLARE_ZIP_FILE_NAME)
      await zipContents(rootFolderPath, zipPath)

      // Send to Datadog
      this.context.stdout.write(chalk.bold('\n🚀 Sending to Datadog Support...\n'))
      await sendToDatadog(zipPath, this.caseId!, this.email!, this.apiKey!, rootFolderPath)
      this.context.stdout.write(chalk.bold('\n✅ Successfully sent flare file to Datadog Support!\n'))

      // Delete contents
      deleteFolder(rootFolderPath)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(`Unable to save configuration: ${err.message}`))
      }
    }

    return 0
  }
}

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
export const checkAuthentication = async () => {
  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (_) {
    return false
  }
}

/**
 * Call the google-cloud run sdk to get the configuration
 * for the given service.
 * @param runClient the google-cloud run sdk client
 * @param serviceName the name of the service
 * @param projectName the project where the service is deployed
 * @param region the region where the service is deployed
 * @returns the configuration for the given service
 */
export const getCloudRunServiceConfig = async (
  runClient: ServicesClient,
  serviceName: string,
  projectName: string,
  region: string
) => {
  const request = {
    name: runClient.servicePath(projectName, region, serviceName),
  }
  const [response] = await runClient.getService(request)

  return response
}

/**
 * Masks environment variables in a Cloud Run service configuration.
 * Makes a copy as to not modify the config in place.
 * @param config
 * @returns masked config
 */
export const maskConfig = (config: any) => {
  // We stringify and parse again to make a deep copy
  const configCopy = JSON.parse(JSON.stringify(config))
  const containers = configCopy.template?.containers
  if (!containers) {
    return configCopy
  }

  for (const container of configCopy.template.containers) {
    for (const envVar of container.env) {
      if (!SKIP_MASKING_CLOUDRUN_ENV_VARS.has(envVar.name)) {
        envVar.value = maskString(envVar.value)
      }
    }
  }

  return configCopy
}

/**
 * Parse and extract project, location, and service from a given name string
 * @param name Cloud Run name, such as "projects/datadog-sandbox/locations/us-east1/services/nicholas-hulston-docker-test"
 * @returns an array of [project, location, service] if a valid name is provided, or undefined otherwise
 */
export const getProjectLocationServiceFromName = (name: string | null | undefined) => {
  if (!name) {
    return
  }

  const components = name.split('/')
  const project = components[1]
  const location = components[3]
  const service = components[5]

  return [service, location, project]
}

/**
 * Generate the insights file
 * @param insightsFilePath path to the insights file
 * @param isDryRun whether or not this is a dry run
 * @param config Lambda function configuration
 */
export const generateInsightsFile = (insightsFilePath: string, isDryRun: boolean, config: IService) => {
  const lines: string[] = []
  // Header
  lines.push('# Flare Insights')
  lines.push('\n_Autogenerated file from `cloud-run flare`_  ')
  if (isDryRun) {
    lines.push('_This command was run in dry mode._')
  }

  // Cloud Run Service Configuration
  const [service, location, project] = getProjectLocationServiceFromName(config.name) ?? ['', '', '']
  lines.push('\n## Cloud Run Service Configuration')
  lines.push(`**Service Name**: \`${service}\`  `)
  lines.push(`**Location**: \`${location}\`  `)
  lines.push(`**Project**: \`${project}\`  `)
  lines.push(`**Description**: \`${config.description ?? 'No description'}\`  `)
  lines.push(`**URI**: \`${config.uri ?? ''}\`  `)
  const containers = config.template?.containers ?? []
  const envVars = new Map<string, string>()
  for (const container of containers) {
    for (const envVar of container.env ?? []) {
      const name = envVar.name
      const value = envVar.value
      if (name && value) {
        envVars.set(name, value)
      }
    }
  }
  lines.push('**Environment Variables**:')
  if (envVars.size === 0) {
    lines.push('- No environment variables found.')
  }
  for (const [key, value] of envVars) {
    lines.push(`- \`${key}\`: \`${value}\``)
  }

  // CLI Insights
  lines.push('\n ## CLI')
  lines.push(`**Run Location**: \`${process.cwd()}\`  `)
  lines.push(`**CLI Version**: \`${version}\`  `)
  const timeString = new Date().toISOString().replace('T', ' ').replace('Z', '') + ' UTC'
  lines.push(`**Timestamp**: \`${timeString}\`  `)

  writeFile(insightsFilePath, lines.join('\n'))
}

CloudRunFlareCommand.addPath('cloud-run', 'flare')
CloudRunFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
CloudRunFlareCommand.addOption('service', Command.String('-s,--service'))
CloudRunFlareCommand.addOption('project', Command.String('-p,--project'))
CloudRunFlareCommand.addOption('region', Command.String('-r,--region,-l,--location'))
CloudRunFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
CloudRunFlareCommand.addOption('email', Command.String('-e,--email'))
