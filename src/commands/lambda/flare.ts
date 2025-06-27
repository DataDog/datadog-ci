import * as fs from 'fs'
import util from 'util'

import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  OrderBy,
  OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs'
import {FunctionConfiguration, LambdaClient, LambdaClientConfig, ListTagsCommand} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import upath from 'upath'

import {
  ADDITIONAL_FILES_DIRECTORY,
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  FIPS_ENV_VAR,
  FIPS_IGNORE_ERROR_ENV_VAR,
  FLARE_OUTPUT_DIRECTORY,
  INSIGHTS_FILE_NAME,
  LOGS_DIRECTORY,
  PROJECT_FILES_DIRECTORY,
} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {getProjectFiles, sendToDatadog, validateFilePath, validateStartEndFlags} from '../../helpers/flare'
import {createDirectories, deleteFolder, writeFile, zipContents} from '../../helpers/fs'
import {requestConfirmation, requestFilePath} from '../../helpers/prompt'
import * as helpersRenderer from '../../helpers/renderer'
import {renderAdditionalFiles, renderProjectFiles} from '../../helpers/renderer'
import {formatBytes} from '../../helpers/utils'
import {getLatestVersion, version} from '../../helpers/version'

import {
  AWS_DEFAULT_REGION_ENV_VAR,
  FRAMEWORK_FILES_MAPPING,
  DeploymentFrameworks,
  LAMBDA_PROJECT_FILES,
  EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
} from './constants'
import {
  getAWSCredentials,
  getLambdaFunctionConfig,
  getLayerNameWithVersion,
  getRegion,
  maskConfig,
} from './functions/commons'
import {requestAWSCredentials} from './prompt'
import * as commonRenderer from './renderers/common-renderer'

const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
const TAGS_FILE_NAME = 'tags.json'
const FLARE_ZIP_FILE_NAME = 'lambda-flare-output.zip'
const MAX_LOG_STREAMS = 50
const DEFAULT_LOG_STREAMS = 3
const MAX_LOG_EVENTS_PER_STREAM = 1000
const SUMMARIZED_FIELDS = new Set(['FunctionName', 'Runtime', 'FunctionArn', 'Handler', 'Environment'])

export class LambdaFlareCommand extends Command {
  public static paths = [['lambda', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description:
      'Gather config, logs, tags, project files, and more from a Lambda function and sends them to Datadog support.',
  })

  private isDryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private withLogs = Option.Boolean('--with-logs', false)
  private functionName = Option.String('-f,--function')
  private region = Option.String('-r,--region')
  private caseId = Option.String('-c,--case-id')
  private email = Option.String('-e,--email')
  private start = Option.String('--start')
  private end = Option.String('--end')

  private apiKey?: string
  private credentials?: AwsCredentialIdentity

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  /**
   * Entry point for the `lambda flare` command.
   * Gathers config, logs, tags, project files, and more from a
   * Lambda function and sends them to Datadog support.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)
    const latestCliVersion = await getLatestVersion()
    if (latestCliVersion !== version) {
      this.context.stdout.write(helpersRenderer.renderVersionWarning(latestCliVersion, version))
    }
    this.context.stdout.write(helpersRenderer.renderFlareHeader('Lambda', this.isDryRun))

    // Validate function name
    if (this.functionName === undefined) {
      this.context.stderr.write(helpersRenderer.renderError('No function name specified. [-f,--function]'))

      return 1
    }

    const errorMessages: string[] = []
    // Validate region
    const region = getRegion(this.functionName) ?? this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (region === undefined) {
      errorMessages.push(commonRenderer.renderNoDefaultRegionSpecifiedError())
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

    // Validate start/end flags if both are specified
    let startMillis
    let endMillis
    try {
      ;[startMillis, endMillis] = validateStartEndFlags(this.start, this.end)
    } catch (err) {
      if (err instanceof Error) {
        errorMessages.push(helpersRenderer.renderError(err.message))
      }
    }

    if (errorMessages.length > 0) {
      for (const message of errorMessages) {
        this.context.stderr.write(message)
      }

      return 1
    }

    // Get AWS credentials
    this.context.stdout.write(chalk.bold('\n🔑 Getting AWS credentials...\n'))
    try {
      this.credentials = await getAWSCredentials()
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(err.message))
      }

      return 1
    }
    if (this.credentials === undefined) {
      this.context.stdout.write('\n' + commonRenderer.renderNoAWSCredentialsFound())
      try {
        await requestAWSCredentials()
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(helpersRenderer.renderError(err.message))
        }

        return 1
      }
    }

    // Get and print Lambda function configuration
    this.context.stdout.write(chalk.bold('\n🔍 Fetching Lambda function configuration...\n'))
    const lambdaClientConfig: LambdaClientConfig = {
      region,
      credentials: this.credentials,
      retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    let config: FunctionConfiguration
    try {
      config = await getLambdaFunctionConfig(lambdaClient, this.functionName)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(
          helpersRenderer.renderError(`Unable to get Lambda function configuration: ${err.message}`)
        )
      }

      return 1
    }
    config = maskConfig(config)
    const summarizedConfig = summarizeConfig(config)
    const summarizedConfigStr = util.inspect(summarizedConfig, false, undefined, true)
    this.context.stdout.write(`\n${summarizedConfigStr}\n`)
    this.context.stdout.write(
      chalk.italic(
        `(This is a summary of the configuration. The full configuration will be saved in "${FUNCTION_CONFIG_FILE_NAME}".)\n`
      )
    )

    // Get project files
    this.context.stdout.write(chalk.bold('\n📁 Searching for project files in current directory...\n'))
    const projectFilePaths = await getProjectFiles(LAMBDA_PROJECT_FILES)
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
        const fileName = upath.basename(filePath)
        this.context.stdout.write(`• Added file '${fileName}'\n`)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(err.message)
        }
      }
    }

    // Get tags
    this.context.stdout.write(chalk.bold('\n🏷 Getting Resource Tags...\n'))
    let tags: Record<string, string>
    try {
      tags = await getTags(lambdaClient, region!, config.FunctionArn!)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(helpersRenderer.renderError(err.message))
      }

      return 1
    }
    const tagsLength = Object.keys(tags).length
    if (tagsLength === 0) {
      this.context.stdout.write(helpersRenderer.renderSoftWarning(`No resource tags were found.`))
    } else {
      this.context.stdout.write(`Found ${tagsLength} resource tag(s).\n`)
    }

    // Get CloudWatch logs
    let logs: Map<string, OutputLogEvent[]> = new Map()
    if (this.withLogs) {
      this.context.stdout.write(chalk.bold('\n🌧 Getting CloudWatch logs...\n'))
      try {
        logs = await getAllLogs(region!, this.functionName, startMillis, endMillis)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(helpersRenderer.renderError(err.message))
        }

        return 1
      }
    }

    try {
      // CloudWatch messages
      if (this.withLogs) {
        let message = chalk.bold('\n✅ Found log streams:\n')
        if (logs.size === 0) {
          message = helpersRenderer.renderSoftWarning(
            'No CloudWatch log streams were found. Logs will not be retrieved or sent.'
          )
        }
        this.context.stdout.write(message)

        for (const [logStreamName, logEvents] of logs) {
          let warningMessage = '\n'
          if (logEvents.length === 0) {
            warningMessage = ` - ${helpersRenderer.renderSoftWarning('No log events found in this stream')}`
          }
          this.context.stdout.write(`• ${logStreamName}${warningMessage}`)
        }
      }

      // Create folders
      const rootFolderPath = upath.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = upath.join(rootFolderPath, LOGS_DIRECTORY)
      const projectFilesFolderPath = upath.join(rootFolderPath, PROJECT_FILES_DIRECTORY)
      const additionalFilesFolderPath = upath.join(rootFolderPath, ADDITIONAL_FILES_DIRECTORY)
      this.context.stdout.write(chalk.bold(`\n💾 Saving files to ${rootFolderPath}...\n`))
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      const subFolders = []
      if (logs.size > 0) {
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
      const configFilePath = upath.join(rootFolderPath, FUNCTION_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`• Saved function config to ./${FUNCTION_CONFIG_FILE_NAME}\n`)

      // Write tags file
      if (tagsLength > 0) {
        const tagsFilePath = upath.join(rootFolderPath, TAGS_FILE_NAME)
        writeFile(tagsFilePath, JSON.stringify(tags, undefined, 2))
        this.context.stdout.write(`• Saved tags to ./${TAGS_FILE_NAME}\n`)
      }

      // Write log files
      for (const [logStreamName, logEvents] of logs) {
        if (logEvents.length === 0) {
          continue
        }
        const logFilePath = upath.join(logsFolderPath, `${logStreamName.split('/').join('-')}.csv`)
        const data = convertToCSV(logEvents)
        writeFile(logFilePath, data)
        this.context.stdout.write(`• Saved logs to ./${LOGS_DIRECTORY}/${logStreamName}\n`)
        // Sleep for 1 millisecond so creation times are different
        // This allows the logs to be sorted by creation time by the support team
        await sleep(1)
      }

      // Write project files
      for (const filePath of projectFilePaths) {
        const fileName = upath.basename(filePath)
        const newFilePath = upath.join(projectFilesFolderPath, fileName)
        fs.copyFileSync(filePath, newFilePath)
        this.context.stdout.write(`• Copied ${fileName} to ./${PROJECT_FILES_DIRECTORY}/${fileName}\n`)
      }

      // Write additional files
      const additionalFilesMap = getUniqueFileNames(additionalFilePaths)
      for (const [originalFilePath, newFileName] of additionalFilesMap) {
        const originalFileName = upath.basename(originalFilePath)
        const newFilePath = upath.join(additionalFilesFolderPath, newFileName)
        fs.copyFileSync(originalFilePath, newFilePath)
        this.context.stdout.write(`• Copied ${originalFileName} to ./${ADDITIONAL_FILES_DIRECTORY}/${newFileName}\n`)
      }

      // Write insights file
      try {
        const insightsFilePath = upath.join(rootFolderPath, INSIGHTS_FILE_NAME)
        generateInsightsFile(insightsFilePath, this.isDryRun, config)
        this.context.stdout.write(`• Saved the insights file to ./${INSIGHTS_FILE_NAME}\n`)
      } catch (err) {
        const errorDetails = err instanceof Error ? err.message : ''
        this.context.stdout.write(
          helpersRenderer.renderSoftWarning(`Unable to create INSIGHTS.md file. ${errorDetails}`)
        )
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
      const zipPath = upath.join(rootFolderPath, FLARE_ZIP_FILE_NAME)
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
 * Summarizes the Lambda config as to not flood the terminal
 * @param config
 * @returns a summarized config
 */
export const summarizeConfig = (config: any): any => {
  const summarizedConfig: any = {}
  for (const key in config) {
    if (SUMMARIZED_FIELDS.has(key)) {
      summarizedConfig[key] = config[key]
    }
  }

  return summarizedConfig
}

/**
 * Gets the LOG_STREAM_COUNT latest log stream names, sorted by last event time
 * @param cwlClient CloudWatch Logs client
 * @param logGroupName name of the log group
 * @param startMillis start time in milliseconds or undefined if no start time is specified
 * @param endMillis end time in milliseconds or undefined if no end time is specified
 * @returns an array of the last LOG_STREAM_COUNT log stream names or an empty array if no log streams are found
 * @throws Error if the log streams cannot be retrieved
 */
export const getLogStreamNames = async (
  cwlClient: CloudWatchLogsClient,
  logGroupName: string,
  startMillis?: number,
  endMillis?: number
): Promise<string[]> => {
  const config = {
    logGroupName,
    descending: true,
    orderBy: OrderBy.LastEventTime,
    limit: DEFAULT_LOG_STREAMS,
  }
  const rangeSpecified = startMillis !== undefined && endMillis !== undefined
  if (rangeSpecified) {
    config.limit = MAX_LOG_STREAMS
  }
  const command = new DescribeLogStreamsCommand(config)
  const response = await cwlClient.send(command)
  const logStreams = response.logStreams
  if (logStreams === undefined || logStreams.length === 0) {
    return []
  }

  const output: string[] = []
  for (const logStream of logStreams) {
    const logStreamName = logStream.logStreamName
    if (!logStreamName) {
      continue
    }
    if (rangeSpecified) {
      const firstEventTime = logStream.firstEventTimestamp
      const lastEventTime = logStream.lastEventTimestamp
      if (lastEventTime && lastEventTime < startMillis) {
        continue
      }
      if (firstEventTime && firstEventTime > endMillis) {
        continue
      }
    }
    output.push(logStreamName)
  }

  // Reverse array so the oldest log is created first, so Support Staff can sort by creation time
  return output.reverse()
}

/**
 * Gets the log events for a log stream
 * @param cwlClient
 * @param logGroupName
 * @param logStreamName
 * @param startMillis
 * @param endMillis
 * @returns the log events or an empty array if no log events are found
 * @throws Error if the log events cannot be retrieved
 */
export const getLogEvents = async (
  cwlClient: CloudWatchLogsClient,
  logGroupName: string,
  logStreamName: string,
  startMillis?: number,
  endMillis?: number
): Promise<OutputLogEvent[]> => {
  const config: any = {
    logGroupName,
    logStreamName,
    limit: MAX_LOG_EVENTS_PER_STREAM,
  }
  if (startMillis !== undefined && endMillis !== undefined) {
    config.startTime = startMillis
    config.endTime = endMillis
  }
  const command = new GetLogEventsCommand(config)

  const response = await cwlClient.send(command)
  const logEvents = response.events

  if (logEvents === undefined) {
    return []
  }

  return logEvents
}

/**
 * Gets all CloudWatch logs for a function
 * @param region
 * @param functionName
 * @param startMillis start time in milliseconds or undefined if no end time is specified
 * @param endMillis end time in milliseconds or undefined if no end time is specified
 * @returns a map of log stream names to log events or an empty map if no logs are found
 */
export const getAllLogs = async (
  region: string,
  functionName: string,
  startMillis?: number,
  endMillis?: number
): Promise<Map<string, OutputLogEvent[]>> => {
  const logs = new Map<string, OutputLogEvent[]>()
  const cwlClient = new CloudWatchLogsClient({region, retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY})
  if (functionName.startsWith('arn:aws')) {
    functionName = functionName.split(':')[6]
  }
  const logGroupName = `/aws/lambda/${functionName}`
  let logStreamNames: string[]
  try {
    logStreamNames = await getLogStreamNames(cwlClient, logGroupName, startMillis, endMillis)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    throw new Error(`Unable to get log streams: ${msg}`)
  }

  for (const logStreamName of logStreamNames) {
    let logEvents
    try {
      logEvents = await getLogEvents(cwlClient, logGroupName, logStreamName, startMillis, endMillis)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      throw new Error(`Unable to get log events for stream ${logStreamName}: ${msg}`)
    }
    logs.set(logStreamName, logEvents)
  }

  return logs
}

/**
 * Gets the tags for a function
 * @param lambdaClient
 * @param region
 * @param arn
 * @returns the tags or an empty object if no tags are found
 * @throws Error if the tags cannot be retrieved
 */
export const getTags = async (
  lambdaClient: LambdaClient,
  region: string,
  arn: string
): Promise<Record<string, string>> => {
  if (!arn.startsWith('arn:aws')) {
    throw Error(`Invalid function ARN: ${arn}`)
  }
  const command = new ListTagsCommand({
    Resource: arn,
  })
  try {
    const response = await lambdaClient.send(command)

    return response.Tags ?? {}
  } catch (err) {
    let message = ''
    if (err instanceof Error) {
      message = err.message
    }
    throw Error(`Unable to get resource tags: ${message}`)
  }
}

/**
 * Generate unique file names
 * If the original file name is unique, keep it as is
 * Otherwise, replace separators in the file path with dashes
 * @param filePaths the list of file paths
 * @returns a mapping of file paths to new file names
 */
export const getUniqueFileNames = (filePaths: Set<string>): Map<string, string> => {
  // Count occurrences of each filename
  const fileNameCount: {[fileName: string]: number} = {}
  filePaths.forEach((filePath) => {
    const fileName = upath.basename(filePath)
    const count = fileNameCount[fileName] || 0
    fileNameCount[fileName] = count + 1
  })

  // Create new filenames
  const filePathsToNewFileNames = new Map<string, string>()
  filePaths.forEach((filePath) => {
    const fileName = upath.basename(filePath)
    if (fileNameCount[fileName] > 1) {
      // Trim leading and trailing '/'s and '\'s
      const trimRegex = /^\/+|\/+$/g
      const filePathTrimmed = filePath.replace(trimRegex, '')
      // Replace '/'s and '\'s with '-'s
      const newFileName = filePathTrimmed.split('/').join('-')
      filePathsToNewFileNames.set(filePath, newFileName)
    } else {
      filePathsToNewFileNames.set(filePath, fileName)
    }
  })

  return filePathsToNewFileNames
}

/**
 * Convert the log events to a CSV string
 * @param logEvents array of log events
 * @returns the CSV string
 */
export const convertToCSV = (logEvents: OutputLogEvent[]): string => {
  const rows = [['timestamp', 'datetime', 'message']]
  for (const logEvent of logEvents) {
    const timestamp = `"${logEvent.timestamp ?? ''}"`
    let datetime = ''
    if (logEvent.timestamp) {
      const date = new Date(logEvent.timestamp)
      datetime = date.toISOString().replace('T', ' ').replace('Z', '')
    }
    const message = `"${logEvent.message ?? ''}"`
    rows.push([timestamp, datetime, message])
  }

  return rows.join('\n')
}

/**
 * @param ms number of milliseconds to sleep
 */
export const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get the framework used based on the files in the directory
 * @returns the framework used or undefined if no framework is found
 */
export const getFramework = (): string => {
  const frameworks = new Set<DeploymentFrameworks>()
  const files = fs.readdirSync(process.cwd())
  files.forEach((file) => {
    if (FRAMEWORK_FILES_MAPPING.has(file)) {
      frameworks.add(FRAMEWORK_FILES_MAPPING.get(file)!)
    }
  })

  if (frameworks.size > 0) {
    return Array.from(frameworks).join(', ')
  }

  return DeploymentFrameworks.Unknown
}

/**
 * Generate the insights file
 * @param insightsFilePath path to the insights file
 * @param isDryRun whether or not this is a dry run
 * @param config Lambda function configuration
 */
export const generateInsightsFile = (
  insightsFilePath: string,
  isDryRun: boolean,
  config: FunctionConfiguration
): void => {
  const lines: string[] = []
  // Header
  lines.push('# Flare Insights')
  lines.push('\n_Autogenerated file from `lambda flare`_  ')
  if (isDryRun) {
    lines.push('_This command was run in dry mode._')
  }

  // AWS Lambda Configuration
  lines.push('\n## AWS Lambda Configuration')
  lines.push(`**Function Name**: \`${config.FunctionName}\`  `)
  lines.push(`**Function ARN**: \`${config.FunctionArn}\`  `)
  lines.push(`**Runtime**: \`${config.Runtime}\`  `)
  lines.push(`**Handler**: \`${config.Handler}\`  `)
  lines.push(`**Timeout**: \`${config.Timeout}\`  `)
  lines.push(`**Memory Size**: \`${config.MemorySize}\`  `)
  const architectures = config.Architectures ?? ['Unknown']
  lines.push(`**Architecture**: \`${architectures.join(', ')}\`  `)

  lines.push('**Environment Variables**:')
  const envVars = Object.entries(config.Environment?.Variables ?? {})
  if (envVars.length === 0) {
    lines.push('- No environment variables found.')
  }
  for (const [key, value] of envVars) {
    lines.push(`- \`${key}\`: \`${value}\``)
  }

  lines.push('\n**Layers**:')
  const layers = config.Layers ?? []
  if (layers.length === 0) {
    lines.push(' - No layers found.')
  }
  let codeSize = config.CodeSize ?? 0
  layers.forEach((layer) => {
    const nameAndVersion = getLayerNameWithVersion(layer.Arn ?? '')
    if (nameAndVersion) {
      lines.push(`- \`${nameAndVersion}\``)
    }
    codeSize += layer.CodeSize ?? 0
  })
  lines.push(`\n**Package Size**: \`${formatBytes(codeSize)}\``)

  // CLI Insights
  lines.push('\n ## CLI')
  lines.push(`**Run Location**: \`${process.cwd()}\`  `)
  lines.push(`**CLI Version**: \`${version}\`  `)
  const timeString = new Date().toISOString().replace('T', ' ').replace('Z', '') + ' UTC'
  lines.push(`**Timestamp**: \`${timeString}\`  `)
  lines.push(`**Framework**: \`${getFramework()}\``)

  writeFile(insightsFilePath, lines.join('\n'))
}
