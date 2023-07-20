import * as fs from 'fs'
import * as path from 'path'
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
import {Command} from 'clipanion'
import inquirer from 'inquirer'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR, FLARE_OUTPUT_DIRECTORY, FLARE_ZIP_FILE_NAME} from '../../constants'
import {deleteFolder, writeFile, zipContents} from '../../helpers/fileSystem'
import {sendToDatadog} from '../../helpers/flareFunctions'
import * as helpersRenderer from '../../helpers/renderer'

import {AWS_DEFAULT_REGION_ENV_VAR} from './constants'
import {getAWSCredentials, getLambdaFunctionConfig, getRegion, maskStringifiedEnvVar} from './functions/commons'
import {confirmationQuestion, requestAWSCredentials} from './prompt'
import * as commonRenderer from './renderers/common-renderer'

const LOGS_DIRECTORY = 'logs'
const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
const TAGS_FILE_NAME = 'tags.json'
const MAX_LOG_STREAMS = 50
const DEFAULT_LOG_STREAMS = 3
const MAX_LOG_EVENTS_PER_STREAM = 1000

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private withLogs = false
  private functionName?: string
  private region?: string
  private apiKey?: string
  private caseId?: string
  private email?: string
  private start?: string
  private end?: string
  private credentials?: AwsCredentialIdentity

  /**
   * Entry point for the `lambda flare` command.
   * Gathers lambda function configuration and sends it to Datadog.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute() {
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

    if (!this.isDryRun) {
      // Validate case ID
      if (this.caseId === undefined) {
        errorMessages.push(helpersRenderer.renderError('No case ID specified. [-c,--case-id]'))
      }

      // Validate email
      if (this.email === undefined) {
        errorMessages.push(helpersRenderer.renderError('No email specified. [-e,--email]'))
      }
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
    this.context.stdout.write('\n🔑 Getting AWS credentials...\n')
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
    this.context.stdout.write('\n🔍 Fetching Lambda function configuration...\n')
    const lambdaClientConfig: LambdaClientConfig = {
      region,
      credentials: this.credentials,
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
    const configStr = util.inspect(config, false, undefined, true)
    this.context.stdout.write(`\n${configStr}\n`)

    // Get tags
    this.context.stdout.write('\n🏷 Getting Resource Tags...\n')
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
      this.context.stdout.write(`✅ Found ${tagsLength} resource tags.\n`)
    }

    // Get CloudWatch logs
    let logs: Map<string, OutputLogEvent[]> = new Map()
    if (this.withLogs) {
      this.context.stdout.write('\n☁️ Getting CloudWatch logs...\n')
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
        let message = '\n✅ Found log streams:\n'
        if (logs.size === 0) {
          message = helpersRenderer.renderSoftWarning(
            'No CloudWatch log streams were found. Logs will not be retrieved or sent.'
          )
        }
        this.context.stdout.write(message)

        for (const [logStreamName, logEvents] of logs) {
          let warningMessage = '\n'
          if (logEvents.length === 0) {
            warningMessage = ' - ' + helpersRenderer.renderSoftWarning('No log events found in this stream')
          }
          this.context.stdout.write(`• ${logStreamName}${warningMessage}`)
        }
      }

      // Create folders
      this.context.stdout.write('\n💾 Saving files...\n')
      const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = path.join(rootFolderPath, LOGS_DIRECTORY)
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      createDirectories(rootFolderPath, logsFolderPath, logs)

      // Write files
      const configFilePath = path.join(rootFolderPath, FUNCTION_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`• Saved function config to ${configFilePath}\n`)
      if (tagsLength > 0) {
        const tagsFilePath = path.join(rootFolderPath, TAGS_FILE_NAME)
        writeFile(tagsFilePath, JSON.stringify(tags, undefined, 2))
        this.context.stdout.write(`• Saved tags to ${tagsFilePath}\n`)
      }
      for (const [logStreamName, logEvents] of logs) {
        if (logEvents.length === 0) {
          continue
        }
        const logFilePath = path.join(logsFolderPath, `${logStreamName.split('/').join('-')}.csv`)
        const data = convertToCSV(logEvents)
        writeFile(logFilePath, data)
        this.context.stdout.write(`• Saved logs to ${logFilePath}\n`)
        // Sleep for 1 millisecond so creation times are different
        // This allows the logs to be sorted by creation time by the support team
        await sleep(1)
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
      const answer = await inquirer.prompt(
        confirmationQuestion('Are you sure you want to send the flare file to Datadog Support?')
      )
      if (!answer.confirmation) {
        this.context.stdout.write('\n🚫 The flare files were not sent based on your selection.')
        this.context.stdout.write(outputMsg)

        return 0
      }

      // Zip folder
      const zipPath = path.join(rootFolderPath, FLARE_ZIP_FILE_NAME)
      await zipContents(rootFolderPath, zipPath)

      // Send to Datadog
      this.context.stdout.write('\n🚀 Sending to Datadog Support...\n')
      await sendToDatadog(zipPath, this.caseId!, this.email!, this.apiKey!, rootFolderPath)
      this.context.stdout.write('\n✅ Successfully sent flare file to Datadog Support!\n')

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
 * Validate the start and end flags and adds error messages if found
 * @param start start time as a string
 * @param end end time as a string
 * @throws error if start or end are not valid numbers
 * @returns [startMillis, endMillis] as numbers or [undefined, undefined] if both are undefined
 */
export const validateStartEndFlags = (start: string | undefined, end: string | undefined) => {
  if (!start && !end) {
    return [undefined, undefined]
  }

  if (!start) {
    throw Error('Start time is required when end time is specified. [--start]')
  }
  if (!end) {
    throw Error('End time is required when start time is specified. [--end]')
  }

  const startMillis = Number(start)
  let endMillis = Number(end)
  if (isNaN(startMillis)) {
    throw Error(`Start time must be a time in milliseconds since Unix Epoch. '${start}' is not a number.`)
  }
  if (isNaN(endMillis)) {
    throw Error(`End time must be a time in milliseconds since Unix Epoch. '${end}' is not a number.`)
  }

  // Required for AWS SDK to work correctly
  endMillis = Math.min(endMillis, Date.now())

  if (startMillis >= endMillis) {
    throw Error('Start time must be before end time.')
  }

  return [startMillis, endMillis]
}

/**
 * Mask the environment variables in a Lambda function configuration
 * @param config
 */
export const maskConfig = (config: FunctionConfiguration) => {
  const environmentVariables = config.Environment?.Variables
  if (!environmentVariables) {
    return config
  }

  const replacer = maskStringifiedEnvVar(environmentVariables)
  const stringifiedConfig = JSON.stringify(config, replacer)

  return JSON.parse(stringifiedConfig) as FunctionConfiguration
}

/**
 * Creates the root folder and the logs sub-folder
 * @param rootFolderPath path to the root folder
 * @param logsFolderPath path to the logs folder
 * @param logs array of logs
 * @throws Error if the root folder cannot be deleted or folders cannot be created
 */
export const createDirectories = (
  rootFolderPath: string,
  logsFolderPath: string,
  logs: Map<string, OutputLogEvent[]>
) => {
  try {
    fs.mkdirSync(rootFolderPath)
    if (logs.size > 0) {
      fs.mkdirSync(logsFolderPath)
    }
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to create directories: ${err.message}`)
    }
  }
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
  startMillis: number | undefined,
  endMillis: number | undefined
) => {
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
      if (lastEventTime && lastEventTime < startMillis!) {
        continue
      }
      if (firstEventTime && firstEventTime > endMillis!) {
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
  startMillis: number | undefined,
  endMillis: number | undefined
) => {
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
  startMillis: number | undefined,
  endMillis: number | undefined
) => {
  const logs = new Map<string, OutputLogEvent[]>()
  const cwlClient = new CloudWatchLogsClient({region})
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
export const getTags = async (lambdaClient: LambdaClient, region: string, arn: string) => {
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
 * Convert the log events to a CSV string
 * @param logEvents array of log events
 * @returns the CSV string
 */
export const convertToCSV = (logEvents: OutputLogEvent[]) => {
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
export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('withLogs', Command.Boolean('--with-logs'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
LambdaFlareCommand.addOption('start', Command.String('--start'))
LambdaFlareCommand.addOption('end', Command.String('--end'))
