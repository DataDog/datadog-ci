import IService = google.cloud.run.v2.IService
import IContainer = google.cloud.run.v2.IContainer
import fs from 'fs'
import path from 'path'
import process from 'process'
import util from 'util'

import {Logging} from '@google-cloud/logging'
import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {GoogleAuth} from 'google-auth-library'

import {
  ADDITIONAL_FILES_DIRECTORY,
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  FLARE_OUTPUT_DIRECTORY,
  FLARE_PROJECT_FILES,
  LOGS_DIRECTORY,
  PROJECT_FILES_DIRECTORY,
} from '../../constants'
import {getProjectFiles, sendToDatadog, validateFilePath} from '../../helpers/flare'
import {createDirectories, deleteFolder, writeFile, zipContents} from '../../helpers/fs'
import {requestConfirmation, requestFilePath} from '../../helpers/prompt'
import * as helpersRenderer from '../../helpers/renderer'
import {renderAdditionalFiles, renderProjectFiles} from '../../helpers/renderer'
import {formatBytes, maskString} from '../../helpers/utils'

import {getUniqueFileNames} from '../lambda/flare'

import {SKIP_MASKING_CLOUDRUN_ENV_VARS} from './constants'
import {CloudRunLog, LogConfig} from './interfaces'
import {renderAuthenticationInstructions} from './renderer'

const SERVICE_CONFIG_FILE_NAME = 'service_config.json'
const FLARE_ZIP_FILE_NAME = 'cloud-run-flare-output.zip'
const ALL_LOGS_FILE_NAME = 'all_logs.csv'
const WARNING_LOGS_FILE_NAME = 'warning_logs.csv'
const ERRORS_LOGS_FILE_NAME = 'error_logs.csv'
const DEBUG_LOGS_FILE_NAME = 'debug_logs.csv'

// Must be in range 0 - 1000. If more logs are needed, pagination must be implemented
export const MAX_LOGS = 1000
// How old the logs can be in minutes. Skip older logs
const MAX_LOG_AGE_MINUTES = 1440
const FILTER_ORDER = 'timestamp asc'
// Types of log files to create
const LOG_CONFIGS: LogConfig[] = [
  {type: 'total', fileName: ALL_LOGS_FILE_NAME},
  {type: 'warning', severityFilter: ' AND severity>="WARNING"', fileName: WARNING_LOGS_FILE_NAME},
  {type: 'error', severityFilter: ' AND severity>="ERROR"', fileName: ERRORS_LOGS_FILE_NAME},
  {type: 'debug', severityFilter: ' AND severity="DEBUG"', fileName: DEBUG_LOGS_FILE_NAME},
]

export class CloudRunFlareCommand extends Command {
  public static paths = [['cloud-run', 'flare']]

  private isDryRun = Option.Boolean('-d,--dry', false)
  private withLogs = Option.Boolean('--with-logs', false)
  private service = Option.String('-s,--service')
  private project = Option.String('-p,--project')
  private region = Option.String('-r,--region,-l,--location')
  private caseId = Option.String('-c,--case-id')
  private email = Option.String('-e,--email')

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
    const summarizedConfig = summarizeConfig(config)
    // 10 is the depth when inspecting the config file. Cloud-run configs have high depth, so
    // we must raise the depth from the default depth of 2.
    const summarizedConfigStr = util.inspect(summarizedConfig, false, 10, true)
    this.context.stdout.write(`\n${summarizedConfigStr}\n`)
    this.context.stdout.write(
      chalk.italic(
        `(This is a summary of the configuration. The full configuration will be saved in "${SERVICE_CONFIG_FILE_NAME}".)\n`
      )
    )

    // Get project files
    this.context.stdout.write(chalk.bold('\n📁 Searching for project files in current directory...\n'))
    const projectFilePaths = await getProjectFiles(FLARE_PROJECT_FILES)
    this.context.stdout.write(renderProjectFiles(projectFilePaths))

    // Additional files
    this.context.stdout.write('\n')
    const additionalFilePaths = new Set<string>()
    let confirmAdditionalFiles
    try {
      confirmAdditionalFiles = await requestConfirmation('Do you want to specify any additional files to flare?', false)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(err.message))
      }

      return 1
    }

    while (confirmAdditionalFiles) {
      this.context.stdout.write('\n')
      let filePath: string
      try {
        filePath = await requestFilePath()
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(helpersRenderer.renderError(err.message))
        }

        return 1
      }

      if (filePath === '') {
        this.context.stdout.write(renderAdditionalFiles(additionalFilePaths))
        break
      }

      try {
        filePath = validateFilePath(filePath, projectFilePaths, additionalFilePaths)
        additionalFilePaths.add(filePath)
        const fileName = path.basename(filePath)
        this.context.stdout.write(`• Added file '${fileName}'\n`)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(err.message)
        }
      }
    }

    // Get logs
    const logFileMappings = new Map<string, CloudRunLog[]>()
    if (this.withLogs) {
      this.context.stdout.write(chalk.bold('\n📖 Getting logs...\n'))

      const logClient = new Logging({projectId: this.project})
      for (const logConfig of LOG_CONFIGS) {
        try {
          const logs = await getLogs(logClient, this.service!, this.region!, logConfig.severityFilter)
          if (logs.length === 0) {
            this.context.stdout.write(`• No ${logConfig.type} logs were found\n`)
          } else {
            this.context.stdout.write(`• Found ${logs.length} ${logConfig.type} logs\n`)
            logFileMappings.set(logConfig.fileName, logs)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          this.context.stderr.write(`• Unable to get ${logConfig.type} logs: ${msg}\n`)
        }
      }
    }

    try {
      // Create folders
      const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = path.join(rootFolderPath, LOGS_DIRECTORY)
      const projectFilesFolderPath = path.join(rootFolderPath, PROJECT_FILES_DIRECTORY)
      const additionalFilesFolderPath = path.join(rootFolderPath, ADDITIONAL_FILES_DIRECTORY)
      this.context.stdout.write(chalk.bold(`\n💾 Saving files to ${rootFolderPath}...\n`))
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      const subFolders = []
      if (logFileMappings.size > 0) {
        subFolders.push(logsFolderPath)
      }
      if (projectFilePaths.size > 0) {
        subFolders.push(projectFilesFolderPath)
      }
      if (additionalFilePaths.size > 0) {
        subFolders.push(additionalFilesFolderPath)
      }
      createDirectories(rootFolderPath, subFolders)

      // Write config file
      const configFilePath = path.join(rootFolderPath, SERVICE_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`• Saved function config to ./${SERVICE_CONFIG_FILE_NAME}\n`)

      // Write logs
      for (const [fileName, logs] of logFileMappings) {
        const logFilePath = path.join(logsFolderPath, fileName)
        saveLogsFile(logs, logFilePath)
        this.context.stdout.write(`• Saved logs to ./${LOGS_DIRECTORY}/${fileName}\n`)
      }

      // Write project files
      for (const filePath of projectFilePaths) {
        const fileName = path.basename(filePath)
        const newFilePath = path.join(projectFilesFolderPath, fileName)
        fs.copyFileSync(filePath, newFilePath)
        this.context.stdout.write(`• Copied ${fileName} to ./${PROJECT_FILES_DIRECTORY}/${fileName}\n`)
      }

      // Write additional files
      const additionalFilesMap = getUniqueFileNames(additionalFilePaths)
      for (const [originalFilePath, newFileName] of additionalFilesMap) {
        const originalFileName = path.basename(originalFilePath)
        const newFilePath = path.join(additionalFilesFolderPath, newFileName)
        fs.copyFileSync(originalFilePath, newFilePath)
        this.context.stdout.write(`• Copied ${originalFileName} to ./${ADDITIONAL_FILES_DIRECTORY}/${newFileName}\n`)
      }

      // Exit if dry run
      const outputMsg = `\nℹ️ Your output files are located at: ${rootFolderPath}\n\n`
      if (this.isDryRun) {
        this.context.stdout.write(
          '\n🚫 The flare files were not sent because the command was executed in dry run mode.'
        )
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
  const configCopy: IService = JSON.parse(JSON.stringify(config))
  const containers = configCopy.template?.containers
  if (!containers) {
    return configCopy
  }

  for (const container of containers) {
    const env = container.env ?? []
    for (const envVar of env) {
      const name = envVar.name
      const val = envVar.value
      if (!name || !val) {
        continue
      }
      if (!SKIP_MASKING_CLOUDRUN_ENV_VARS.has(name)) {
        envVar.value = maskString(val)
      }
    }
  }

  return configCopy
}

/**
 * Summarizes the Cloud Run config as to not flood the terminal
 * @param config
 * @returns a summarized config
 */
export const summarizeConfig = (config: IService) => {
  const summarizedConfig: any = {}
  summarizedConfig.name = config.name
  summarizedConfig.uid = config.uid
  summarizedConfig.uri = config.uri

  // Get env vars and image for each containers
  const template = config.template
  if (template) {
    const summarizedContainers: IContainer[] = []
    const containers = template.containers ?? []
    containers.forEach((container) => {
      const summarizedContainer: any = {}
      summarizedContainer.env = container.env
      summarizedContainer.image = container.image
      summarizedContainers.push(summarizedContainer)
    })
    summarizedConfig.containers = summarizedContainers
  }

  return summarizedConfig
}

/**
 * Gets recent logs
 * @param logClient Logging client
 * @param serviceId
 * @param location
 * @param severityFilter if included, adds the string to the filter
 * @returns array of logs as CloudRunLog interfaces
 */
export const getLogs = async (logClient: Logging, serviceId: string, location: string, severityFilter?: string) => {
  const logs: CloudRunLog[] = []

  // Only get recent logs
  const date = new Date()
  date.setMinutes(date.getMinutes() - MAX_LOG_AGE_MINUTES)
  const formattedDate = date.toISOString()

  // Query options
  let filter = `resource.labels.service_name="${serviceId}" AND resource.labels.location="${location}" AND timestamp>="${formattedDate}" AND (textPayload:* OR httpRequest:*)`
  // We only want to get logs from the last `MAX_LOG_AGE_MINUTES` to make sure they are relevant.
  // We also only want to include logs with a textPayload or logs that were an HTTP request.
  // Any other logs are just audit logs which are spammy and don't have any relevant information.
  filter += severityFilter ?? ''

  const options = {
    filter,
    orderBy: FILTER_ORDER,
    pageSize: MAX_LOGS,
  }

  const [entries] = await logClient.getEntries(options)

  for (const entry of entries) {
    let msg = ''
    if (entry.metadata.textPayload) {
      msg = entry.metadata.textPayload
    }
    if (entry.metadata.httpRequest) {
      const request = entry.metadata.httpRequest
      const status = request.status ?? ''
      let ms = 'unknown'
      const latency = request.latency
      if (latency) {
        ms = (Number(latency.seconds) * 1000 + Math.round(Number(latency.nanos) / 1000000)).toString()
      }
      const bytes = formatBytes(Number(request.responseSize))
      const method = request.requestMethod ?? ''
      const requestUrl = request.requestUrl ?? ''
      msg += `${method} ${status}. responseSize: ${bytes}. latency: ${ms} ms. requestUrl: ${requestUrl}`
    }

    const log: CloudRunLog = {
      severity: entry.metadata.severity?.toString() ?? '',
      timestamp: entry.metadata.timestamp?.toString() ?? '',
      logName: entry.metadata.logName ?? '',
      message: `"${msg}"`,
    }

    logs.push(log)
  }

  return logs
}

/**
 * Save logs in a CSV format
 * @param logs array of logs stored as CloudRunLog interfaces
 * @param filePath path to save the CSV file
 */
export const saveLogsFile = (logs: CloudRunLog[], filePath: string) => {
  const rows = [['severity', 'timestamp', 'logName', 'message']]
  logs.forEach((log) => {
    const severity = `"${log.severity}"`
    const timestamp = `"${log.timestamp}"`
    const logName = `"${log.logName}"`
    const logMessage = `"${log.message}"`
    rows.push([severity, timestamp, logName, logMessage])
  })
  const data = rows.join('\n')
  writeFile(filePath, data)
}
