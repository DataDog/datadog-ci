import assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import util from 'util'

import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
  OutputLogEvent,
} from '@aws-sdk/client-cloudwatch-logs'
import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import axios from 'axios'
import {Command} from 'clipanion'
import FormData from 'form-data'
import JSZip from 'jszip'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from './constants'
import {getAWSCredentials, getLambdaFunctionConfig, getRegion} from './functions/commons'
import {requestAWSCredentials} from './prompt'
import * as commonRenderer from './renderers/common-renderer'
import * as flareRenderer from './renderers/flare-renderer'

const {version} = require('../../../package.json')

const ENDPOINT_URL = 'https://datad0g.com/api/ui/support/serverless/flare'
const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
const LOGS_DIRECTORY = 'logs'
const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
const ZIP_FILE_NAME = 'lambda-flare-output.zip'

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private withLogs = false
  private functionName?: string
  private region?: string
  private apiKey?: string
  private caseId?: string
  private email?: string
  private credentials?: AwsCredentialIdentity

  /**
   * Entry point for the `lambda flare` command.
   * Gathers lambda function configuration and sends it to Datadog.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute() {
    this.context.stdout.write(flareRenderer.renderLambdaFlareHeader(this.isDryRun))

    // Validate function name
    const errorMessages = []
    if (this.functionName === undefined) {
      errorMessages.push(commonRenderer.renderError('No function name specified. [-f,--function]'))
    }

    // Validate region
    const region = getRegion(this.functionName ?? '') ?? this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (region === undefined) {
      errorMessages.push(commonRenderer.renderNoDefaultRegionSpecifiedError())
    }

    // Validate Datadog API key
    this.apiKey = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      errorMessages.push(
        commonRenderer.renderError(
          'No Datadog API key specified. Set an API key with the DATADOG_API_KEY environment variable.'
        )
      )
    }

    // Validate case ID
    if (this.caseId === undefined) {
      errorMessages.push(commonRenderer.renderError('No case ID specified. [-c,--case-id]'))
    }

    // Validate email
    if (this.email === undefined) {
      errorMessages.push(commonRenderer.renderError('No email specified. [-e,--email]'))
    }

    // Exit if there are errors
    if (errorMessages.length > 0) {
      this.context.stderr.write(errorMessages.join('') + '\n')

      return 1
    }
    assert(this.functionName !== undefined)

    // Get AWS credentials
    this.context.stdout.write('\n🔑 Getting AWS credentials...\n')
    try {
      this.credentials = await getAWSCredentials()
    } catch (err) {
      this.context.stderr.write(commonRenderer.renderError(err.message))

      return 1
    }
    if (this.credentials === undefined) {
      this.context.stdout.write('\n' + commonRenderer.renderNoAWSCredentialsFound())
      try {
        await requestAWSCredentials()
      } catch (err) {
        this.context.stderr.write(commonRenderer.renderError(err.message))

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
    let config
    try {
      config = await getLambdaFunctionConfig(lambdaClient, this.functionName)
    } catch (err) {
      this.context.stderr.write(
        commonRenderer.renderError(`Unable to get Lambda function configuration: ${err.message}`)
      )

      return 1
    }
    const configStr = util.inspect(config, false, undefined, true)
    this.context.stdout.write(`\n${configStr}\n`)

    // Get CloudWatch logs
    const logs: [string, OutputLogEvent[]][] = []
    if (this.withLogs) {
      this.context.stdout.write('\n☁️ Getting CloudWatch logs...\n')
      const cwlClient = new CloudWatchLogsClient({region})
      const functionName = this.functionName.startsWith('arn:aws') ? this.functionName.split(':')[6] : this.functionName
      const logGroupName = `/aws/lambda/${functionName}`
      let logStreamNames
      try {
        logStreamNames = await getLogStreamNames(cwlClient, logGroupName)
      } catch (err) {
        this.context.stderr.write(commonRenderer.renderError(`Unable to get log streams: ${err.message}`))

        return 1
      }
      if (logStreamNames === undefined) {
        this.context.stdout.write(
          commonRenderer.renderSoftWarning('No CloudWatch logs were found. Logs will not be retrieved or sent.\n')
        )
      } else {
        this.context.stdout.write(`\n✅ Found log streams:\n• ${logStreamNames.join('\n• ')}\n\n`)
        for (const logStreamName of logStreamNames) {
          let logEvents
          try {
            logEvents = await getLogEvents(cwlClient, logGroupName, logStreamName)
          } catch (err) {
            this.context.stderr.write(
              commonRenderer.renderError(`Unable to get log events for stream ${logStreamName}: ${err.message}`)
            )

            return 1
          }
          if (logEvents === undefined) {
            this.context.stdout.write(
              commonRenderer.renderSoftWarning(`No CloudWatch logs found for stream ${logStreamName}. Skipping...`)
            )
            continue
          }
          logs.push([logStreamName, logEvents])
        }
      }
    }

    this.context.stdout.write('\n💾 Saving files...\n')
    try {
      // Create folders
      const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = path.join(rootFolderPath, LOGS_DIRECTORY)
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      createDirectories(rootFolderPath, logsFolderPath, logs.length > 0)

      // Write files
      const configFilePath = path.join(rootFolderPath, FUNCTION_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`${logs.length > 0 ? '• ' : ''}Saved function config to ${configFilePath}\n`)
      for (const [logStreamName, logEvents] of logs) {
        const logFilePath = path.join(logsFolderPath, `${logStreamName.split('/').join('-')}.csv`)
        const data = convertToCSV(logEvents)
        writeFile(logFilePath, data)
        this.context.stdout.write(`• Saved logs to ${logFilePath}\n`)
        // Sleep for 1 millisecond so OS can sort files by creation time
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      // Exit if dry run
      if (this.isDryRun) {
        this.context.stdout.write('\n🚫 The flare files were not sent as it was executed in dry run mode.')
        this.context.stdout.write(`\nℹ️ Your output files are located at: ${rootFolderPath}\n\n`)

        return 0
      }

      // Zip folder
      const zipPath = path.join(rootFolderPath, ZIP_FILE_NAME)
      await zipContents(rootFolderPath, zipPath)

      // Send to Datadog
      this.context.stdout.write('\n🚀 Sending to Datadog Support...\n')
      await sendToDatadog(zipPath, this.caseId!, this.email!, this.apiKey!, rootFolderPath)
      this.context.stdout.write('\n✅ Successfully sent flare file to Datadog Support!\n')

      // Delete contents
      deleteFolder(rootFolderPath)
    } catch (err) {
      this.context.stderr.write(commonRenderer.renderError(err.message))

      return 1
    }

    return 0
  }
}

/**
 * Delete a folder and all its contents
 * @param folderPath the folder to delete
 * @throws Error if the deletion fails
 */
export const deleteFolder = (folderPath: string) => {
  try {
    fs.rmSync(folderPath, {recursive: true, force: true})
  } catch (err) {
    throw Error(`Failed to delete files located at ${folderPath}: ${err.message}`)
  }
}

/**
 * Creates the root folder and the logs sub-folder
 * @param rootFolderPath path to the root folder
 * @param logsFolderPath path to the logs folder
 * @param createLogsFolder whether to create the logs folder
 * @throws Error if the root folder cannot be deleted or folders cannot be created
 */
export const createDirectories = (rootFolderPath: string, logsFolderPath: string, createLogsFolder: boolean) => {
  try {
    fs.mkdirSync(rootFolderPath)
    if (createLogsFolder) {
      fs.mkdirSync(logsFolderPath)
    }
  } catch (err) {
    throw Error(`Unable to create directories: ${err.message}`)
  }
}

/**
 * Gets the 3 latest log stream names, sorted by last event time
 * @param cwlClient CloudWatch Logs client
 * @param logGroupName name of the log group
 * @returns an array of the last 3 log stream names or undefined if no log streams are found
 * @throws Error if the log streams cannot be retrieved
 */
export const getLogStreamNames = async (cwlClient: CloudWatchLogsClient, logGroupName: string) => {
  const getLogStreamsCommand = new DescribeLogStreamsCommand({
    logGroupName,
    limit: 3,
    descending: true,
    orderBy: 'LastEventTime',
  })
  const logStreams = (await cwlClient.send(getLogStreamsCommand)).logStreams
  if (logStreams === undefined) {
    return undefined
  }
  const output: string[] = logStreams
    .filter((logStream) => logStream !== undefined)
    .map((logStream) => logStream.logStreamName)
    .filter((logStreamName): logStreamName is string => logStreamName !== undefined && logStreamName.length > 0)

  return output.length === 0 ? undefined : output.reverse()
  // Reverse array so the oldest log is created first, so Support Staff can sort by creation time
}

/**
 * Gets the log events for a log stream
 * @param cwlClient
 * @param logGroupName
 * @param logStreamName
 * @returns the log events or undefined if no log events are found
 * @throws Error if the log events cannot be retrieved
 */
export const getLogEvents = async (cwlClient: CloudWatchLogsClient, logGroupName: string, logStreamName: string) => {
  const params = new GetLogEventsCommand({
    logGroupName,
    logStreamName,
  })
  try {
    const logEvents = (await cwlClient.send(params)).events

    return logEvents === undefined || logEvents.length === 0 ? undefined : logEvents
  } catch (err) {
    throw Error(err.message)
  }
}

/**
 * Write the function config to a file
 * @param filePath path to the file
 * @param data the data to write
 * @throws Error if the file cannot be written
 */
export const writeFile = (filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data)
  } catch (err) {
    throw Error(`Unable to create function configuration file: ${err.message}`)
  }
}

/**
 * Convert the log events to a CSV string
 * @param logEvents array of log events
 * @returns the CSV string
 */
export const convertToCSV = (logEvents: OutputLogEvent[]) => {
  const rows = [['timestamp', 'message']]
  for (const logEvent of logEvents) {
    const timestamp = `"${logEvent.timestamp ?? ''}"`
    const message = `"${logEvent.message ?? ''}"`
    rows.push([timestamp, message])
  }

  return rows.join('\n')
}

/**
 * Zip the contents of the flare folder
 * @param rootFolderPath path to the root folder to zip
 * @param zipPath path to save the zip file
 * @throws Error if the zip fails
 */
export const zipContents = async (rootFolderPath: string, zipPath: string) => {
  const zip = new JSZip()

  const addFolderToZip = (folderPath: string) => {
    if (!fs.existsSync(folderPath)) {
      throw Error(`Folder does not exist: ${folderPath}`)
    }

    const folder = fs.statSync(folderPath)
    if (!folder.isDirectory()) {
      throw Error(`Path is not a directory: ${folderPath}`)
    }

    const contents = fs.readdirSync(folderPath)
    for (const item of contents) {
      const fullPath = path.join(folderPath, item)
      const file = fs.statSync(fullPath)

      if (file.isDirectory()) {
        addFolderToZip(fullPath)
      } else {
        const data = fs.readFileSync(fullPath)
        zip.file(path.relative(rootFolderPath, fullPath), data)
      }
    }
  }

  try {
    addFolderToZip(rootFolderPath)
    const zipContent = await zip.generateAsync({type: 'nodebuffer'})
    fs.writeFileSync(zipPath, zipContent)
  } catch (err) {
    throw Error(`Unable to zip the flare files: ${err.message}`)
  }
}

/**
 * Send the zip file to Datadog support
 * @param zipPath
 * @param caseId
 * @param email
 * @param apiKey
 * @param rootFolderPath
 * @throws Error if the request fails
 */
export const sendToDatadog = async (
  zipPath: string,
  caseId: string,
  email: string,
  apiKey: string,
  rootFolderPath: string
) => {
  const form = new FormData()
  form.append('case_id', caseId)
  form.append('flare_file', fs.createReadStream(zipPath))
  form.append('datadog_ci_version', version)
  form.append('email', email)
  const headerConfig = {
    headers: {
      ...form.getHeaders(),
      'DD-API-KEY': apiKey,
    },
  }

  try {
    await axios.post(ENDPOINT_URL, form, headerConfig)
  } catch (err) {
    // Ensure the root folder is deleted if the request fails
    deleteFolder(rootFolderPath)

    const errResponse: string = err.response?.data?.error
    throw Error(`Failed to send flare file to Datadog Support: ${err.message}. ${errResponse ?? ''}\n`)
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('withLogs', Command.Boolean('--with-logs'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
