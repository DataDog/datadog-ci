import IService = google.cloud.run.v2.IService
import fs from 'fs'
import path from 'path'
import process from 'process'
import util from 'util'

import {Logging} from '@google-cloud/logging'
import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {GoogleAuth} from 'google-auth-library'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR, FLARE_OUTPUT_DIRECTORY, LOGS_DIRECTORY} from '../../constants'
import {sendToDatadog} from '../../helpers/flare'
import {createDirectories, deleteFolder, writeFile, zipContents} from '../../helpers/fs'
import {requestConfirmation} from '../../helpers/prompt'
import * as helpersRenderer from '../../helpers/renderer'
import {formatBytes, maskString} from '../../helpers/utils'

import {SKIP_MASKING_CLOUDRUN_ENV_VARS} from './constants'
import {renderAuthenticationInstructions} from './renderer'

const SERVICE_CONFIG_FILE_NAME = 'service_config.json'
const FLARE_ZIP_FILE_NAME = 'cloudrun-flare-output.zip'
const ALL_LOGS_FILE_NAME = 'all_logs.csv'
const REDUCED_LOGS_FILE_NAME = 'reduced_logs.csv'
const WARNINGS_ERRORS_LOGS_FILE_NAME = 'warnings_errors_logs.csv'

// Logs per page. Must be in range 0 - 1000
const LOGS_PER_PAGE = 1000

export class CloudRunFlareCommand extends Command {
  private isDryRun = false
  private withLogs = false
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

    // Get logs
    const logFileMappings = new Map<Log[], string>()
    if (this.withLogs) {
      this.context.stdout.write(chalk.bold('\n📖 Getting logs...\n'))
      const allLogs = await listLogEntries(this.project!, this.service!, this.region!, false, false)
      this.context.stdout.write(`• Found ${allLogs.length} logs\n`)
      const reducedLogs = await listLogEntries(this.project!, this.service!, this.region!, true, false)
      this.context.stdout.write(`• Found ${reducedLogs.length} important logs\n`)
      const warningsErrorsLogs = await listLogEntries(this.project!, this.service!, this.region!, false, true)
      this.context.stdout.write(`• Found ${warningsErrorsLogs.length} logs with warnings or errors\n`)
      logFileMappings.set(allLogs, ALL_LOGS_FILE_NAME)
      logFileMappings.set(reducedLogs, REDUCED_LOGS_FILE_NAME)
      logFileMappings.set(warningsErrorsLogs, WARNINGS_ERRORS_LOGS_FILE_NAME)
    }

    try {
      // Create folders
      const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = path.join(rootFolderPath, LOGS_DIRECTORY)
      this.context.stdout.write(chalk.bold(`\n💾 Saving files to ${rootFolderPath}...\n`))
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      const subFolders = []
      if (this.withLogs) {
        subFolders.push(logsFolderPath)
      }
      createDirectories(rootFolderPath, subFolders)

      // Write config file
      const configFilePath = path.join(rootFolderPath, SERVICE_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`• Saved function config to ./${SERVICE_CONFIG_FILE_NAME}\n`)

      // Write logs
      for (const [logs, fileName] of logFileMappings) {
        const logFilePath = path.join(logsFolderPath, fileName)
        saveLogs(logs, logFilePath)
        this.context.stdout.write(`• Saved logs to ./${LOGS_DIRECTORY}/${fileName}\n`)
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
      const confirmSendFiles = await requestConfirmation(
        'Are you sure you want to send the flare file to Datadog Support?',
        false
      )
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
        this.context.stderr.write(helpersRenderer.renderError(err.message))
      }

      return 1
    }
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

interface Log {
  severity?: string
  timestamp?: string
  logName?: string | null
  message: string
}

const listLogEntries = async (
  projectId: string,
  serviceId: string,
  location: string,
  reducedLogs: boolean,
  onlyWarningsErrors: boolean
) => {
  const logs: Log[] = []
  const logging = new Logging({projectId})
  let filter = `resource.labels.service_name="${serviceId}" AND resource.labels.location="${location}"`
  if (reducedLogs) {
    filter +=
      ' AND -(protoPayload.methodName="google.cloud.run.v1.Services.GetService") AND -(protoPayload.methodName="google.cloud.run.v2.Services.GetService")'
  }
  if (onlyWarningsErrors) {
    filter += ' AND severity>="WARNING"'
  }
  const orderBy = 'timestamp asc'

  const options = {
    filter,
    orderBy,
    pageSize: LOGS_PER_PAGE,
  }

  const [entries] = await logging.getEntries(options)
  entries.forEach((entry) => {
    let msg
    if (entry.metadata.httpRequest) {
      const request = entry.metadata.httpRequest
      const ms = Number(request.latency?.seconds) * 1000 + Math.round(Number(request.latency?.nanos) / 1000000)
      const bytes = formatBytes(Number(request.responseSize))
      msg = `${request.requestMethod} ${request.status}. responseSize: ${bytes}. latency: ${ms} ms. requestUrl: ${request.requestUrl}`
    }
    if (entry.metadata.textPayload) {
      msg = entry.metadata.textPayload
    }
    if (entry.metadata.protoPayload) {
      msg = entry.metadata.protoPayload.type_url
    }

    if (msg) {
      const log: Log = {
        severity: entry.metadata.severity?.toString(),
        timestamp: entry.metadata.timestamp?.toString(),
        logName: entry.metadata.logName,
        message: msg,
      }
      logs.push(log)
    }
  })

  return logs
}

const saveLogs = (logs: Log[], filePath: string) => {
  if (logs.length === 0) {
    writeFile(filePath, 'No logs found.')

    return
  }

  const rows = [['severity', 'timestamp', 'logName', 'message']]
  logs.forEach((log) => {
    const severity = `"${log.severity ?? ''}"`
    const timestamp = `"${log.timestamp ?? ''}"`
    const logName = `"${log.logName ?? ''}"`
    const logMessage = `"${log.message}"`
    rows.push([severity, timestamp, logName, logMessage])
  })
  const data = rows.join('\n')
  writeFile(filePath, data)
}

CloudRunFlareCommand.addPath('cloud-run', 'flare')
CloudRunFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
CloudRunFlareCommand.addOption('withLogs', Command.Boolean('--with-logs'))
CloudRunFlareCommand.addOption('service', Command.String('-s,--service'))
CloudRunFlareCommand.addOption('project', Command.String('-p,--project'))
CloudRunFlareCommand.addOption('region', Command.String('-r,--region,-l,--location'))
CloudRunFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
CloudRunFlareCommand.addOption('email', Command.String('-e,--email'))
