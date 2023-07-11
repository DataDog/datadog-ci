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
import axios from 'axios'
import chalk from 'chalk'
import {Command} from 'clipanion'
import FormData from 'form-data'
import inquirer from 'inquirer'
import JSZip from 'jszip'

import {
  API_KEY_ENV_VAR,
  AWS_DEFAULT_REGION_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  PROJECT_FILES,
  SKIP_MASKING_ENV_VARS,
} from './constants'
import {getAWSCredentials, getLambdaFunctionConfig, getRegion} from './functions/commons'
import {confirmationQuestion, requestAWSCredentials, requestFilePath} from './prompt'
import * as commonRenderer from './renderers/common-renderer'
import * as flareRenderer from './renderers/flare-renderer'

const {version} = require('../../../package.json')

const ENDPOINT_URL = 'https://datad0g.com/api/ui/support/serverless/flare'
const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
const LOGS_DIRECTORY = 'logs'
const PROJECT_FILES_DIRECTORY = 'project_files'
const ADDITIONAL_FILES_DIRECTORY = 'additional_files'
const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
const TAGS_FILE_NAME = 'tags.json'
const ZIP_FILE_NAME = 'lambda-flare-output.zip'
const LOG_STREAM_COUNT = 3
const FULL_OBFUSCATION = '****************'
const MIDDLE_OBFUSCATION = '**********'

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
    if (this.functionName === undefined) {
      this.context.stderr.write(commonRenderer.renderError('No function name specified. [-f,--function]'))

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
        this.context.stderr.write(commonRenderer.renderError(err.message))
      }

      return 1
    }
    if (this.credentials === undefined) {
      this.context.stdout.write('\n' + commonRenderer.renderNoAWSCredentialsFound())
      try {
        await requestAWSCredentials()
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(commonRenderer.renderError(err.message))
        }

        return 1
      }
    }

    // Get and print Lambda function configuration
    this.context.stdout.write(chalk.bold('\n🔍 Fetching Lambda function configuration...\n'))
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
          commonRenderer.renderError(`Unable to get Lambda function configuration: ${err.message}`)
        )
      }

      return 1
    }
    config = maskConfig(config)
    const configStr = util.inspect(config, false, undefined, true)
    this.context.stdout.write(`\n${configStr}\n`)

    // Get project files
    this.context.stdout.write(chalk.bold('\n📁 Searching for project files in current directory...\n'))
    const projectFilesToPath = await getProjectFiles()
    let projectFilesMessage = chalk.bold('\n✅ Found project file(s):\n')
    if (projectFilesToPath.size === 0) {
      projectFilesMessage = commonRenderer.renderSoftWarning('No project files found.')
    }
    this.context.stdout.write(projectFilesMessage)
    for (const paths of projectFilesToPath.values()) {
      this.context.stdout.write(`• ${paths}\n`)
    }

    // Additional files
    this.context.stdout.write('\n')
    const additionalFiles = new Set<string>()
    const addFilesQuestion = await inquirer.prompt(
      confirmationQuestion('Do you want to specify any additional files to send to Datadog support?')
    )
    while (addFilesQuestion.confirmation) {
      this.context.stdout.write('\n')
      let filePath: string
      try {
        filePath = await requestFilePath()
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(commonRenderer.renderError(err.message))
        }

        return 1
      }

      if (filePath === '') {
        this.context.stdout.write(`Added ${additionalFiles.size} custom file(s):\n`)
        for (const file of additionalFiles) {
          this.context.stdout.write(`• ${file}\n`)
        }
        break
      }

      try {
        filePath = validateFilePath(filePath, projectFilesToPath, additionalFiles)
        additionalFiles.add(filePath)
        this.context.stdout.write(`• Added file '${filePath}'\n`)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(err.message)
        }
      }
    }

    // Get tags
    this.context.stdout.write(chalk.bold('\n🏷  Getting Resource Tags...\n'))
    let tags: Record<string, string>
    try {
      tags = await getTags(lambdaClient, region!, config.FunctionArn!)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(commonRenderer.renderError(err.message))
      }

      return 1
    }
    const tagsLength = Object.keys(tags).length
    if (tagsLength === 0) {
      this.context.stdout.write(commonRenderer.renderSoftWarning(`No resource tags were found.`))
    } else {
      this.context.stdout.write(`Found ${tagsLength} resource tag(s).\n`)
    }

    // Get CloudWatch logs
    let logs: Map<string, OutputLogEvent[]> = new Map()
    if (this.withLogs) {
      this.context.stdout.write(chalk.bold('\n🌧  Getting CloudWatch logs...\n'))
      try {
        logs = await getAllLogs(region!, this.functionName)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(commonRenderer.renderError(err.message))
        }

        return 1
      }
    }

    try {
      // CloudWatch messages
      if (this.withLogs) {
        let message = chalk.bold('\n✅ Found log streams:\n')
        if (logs.size === 0) {
          message = commonRenderer.renderSoftWarning(
            'No CloudWatch log streams were found. Logs will not be retrieved or sent.'
          )
        }
        this.context.stdout.write(message)

        for (const [logStreamName, logEvents] of logs) {
          let warningMessage = '\n'
          if (logEvents.length === 0) {
            warningMessage = ' - ' + commonRenderer.renderSoftWarning('No log events found in this stream')
          }
          this.context.stdout.write(`• ${logStreamName}${warningMessage}`)
        }
      }

      // Create folders
      this.context.stdout.write(chalk.bold('\n💾 Saving files...\n'))
      const rootFolderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
      const logsFolderPath = path.join(rootFolderPath, LOGS_DIRECTORY)
      const projectFilesFolderPath = path.join(rootFolderPath, PROJECT_FILES_DIRECTORY)
      const additionalFilesFolderPath = path.join(rootFolderPath, ADDITIONAL_FILES_DIRECTORY)
      if (fs.existsSync(rootFolderPath)) {
        deleteFolder(rootFolderPath)
      }
      const subFolders = []
      if (logs.size > 0) {
        subFolders.push(logsFolderPath)
      }
      if (projectFilesToPath.size > 0) {
        subFolders.push(projectFilesFolderPath)
      }
      if (additionalFiles.size > 0) {
        subFolders.push(additionalFilesFolderPath)
      }
      createDirectories(rootFolderPath, subFolders)

      // Write config file
      const configFilePath = path.join(rootFolderPath, FUNCTION_CONFIG_FILE_NAME)
      writeFile(configFilePath, JSON.stringify(config, undefined, 2))
      this.context.stdout.write(`• Saved function config to ${configFilePath}\n`)

      // Write tags file
      if (tagsLength > 0) {
        const tagsFilePath = path.join(rootFolderPath, TAGS_FILE_NAME)
        writeFile(tagsFilePath, JSON.stringify(tags, undefined, 2))
        this.context.stdout.write(`• Saved tags to ${tagsFilePath}\n`)
      }

      // Write log files
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

      // Write project files files
      for (const [fileName, filePath] of projectFilesToPath) {
        const newFilePath = path.join(projectFilesFolderPath, fileName)
        fs.copyFileSync(filePath, newFilePath)
        this.context.stdout.write(`• Copied ${fileName} to ${newFilePath}\n`)
      }

      // Write additional files
      for (const filePath of additionalFiles) {
        const fileName = path.basename(filePath)
        const newFilePath = path.join(additionalFilesFolderPath, fileName)
        fs.copyFileSync(filePath, newFilePath)
        this.context.stdout.write(`• Copied ${fileName} to ${newFilePath}\n`)
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
      const zipPath = path.join(rootFolderPath, ZIP_FILE_NAME)
      await zipContents(rootFolderPath, zipPath)

      // Send to Datadog
      this.context.stdout.write(chalk.bold('\n🚀 Sending to Datadog Support...\n'))
      await sendToDatadog(zipPath, this.caseId!, this.email!, this.apiKey!, rootFolderPath)
      this.context.stdout.write(chalk.bold('\n✅ Successfully sent flare file to Datadog Support!\n'))

      // Delete contents
      deleteFolder(rootFolderPath)
    } catch (err) {
      if (err instanceof Error) {
        this.context.stderr.write(commonRenderer.renderError(err.message))
      }

      return 1
    }

    return 0
  }
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

  const maskedEnvironmentVariables: {[key: string]: string} = {}
  for (const [key, value] of Object.entries(environmentVariables)) {
    if (SKIP_MASKING_ENV_VARS.has(key)) {
      maskedEnvironmentVariables[key] = value
      continue
    }
    maskedEnvironmentVariables[key] = getMasking(value)
  }

  return {
    ...config,
    Environment: {
      ...config.Environment,
      Variables: maskedEnvironmentVariables,
    },
  }
}

/**
 * Mask a string but keep the first two and last four characters
 * Mask the entire string if it's short
 * @param original the string to mask
 * @returns the masked string
 */
export const getMasking = (original: string) => {
  // Don't mask booleans
  if (original.toLowerCase() === 'true' || original.toLowerCase() === 'false') {
    return original
  }

  // Dont mask numbers
  if (!isNaN(Number(original))) {
    return original
  }

  // Mask entire string if it's short
  if (original.length < 12) {
    return FULL_OBFUSCATION
  }

  // Keep first two and last four characters if it's long
  const front = original.substring(0, 2)
  const end = original.substring(original.length - 4)

  return front + MIDDLE_OBFUSCATION + end
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
    if (err instanceof Error) {
      throw Error(`Failed to delete files located at ${folderPath}: ${err.message}`)
    }
  }
}

/**
 * Creates the root folder and any subfolders
 * @param rootFolderPath path to the root folder
 * @param subFolders paths to any subfolders to be created
 * @throws Error if the root folder cannot be deleted or folders cannot be created
 */
export const createDirectories = (rootFolderPath: string, subFolders: string[]) => {
  try {
    fs.mkdirSync(rootFolderPath)
    for (const subFolder of subFolders) {
      fs.mkdirSync(subFolder)
    }
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to create directories: ${err.message}`)
    }
  }
}

/**
 * Searches current directory for project files
 * @returns a map of file names to file paths
 */
export const getProjectFiles = async () => {
  const fileToPath = new Map<string, string>()
  const cwd = process.cwd()
  for (const fileName of PROJECT_FILES) {
    const filePath = path.join(cwd, fileName)
    if (fs.existsSync(filePath)) {
      fileToPath.set(fileName, filePath)
    }
  }

  return fileToPath
}

/**
 * Validates a path to a file
 * @param filePath path to the file
 * @param projectFilesToPath map of file names to file paths
 * @param additionalFiles set of additional file paths
 * @throws Error if the file path is invalid or the file was already added
 * @returns the full path to the file
 */
export const validateFilePath = (
  filePath: string,
  projectFilesToPath: Map<string, string>,
  additionalFiles: Set<string>
) => {
  const originalPath = filePath
  filePath = fs.existsSync(filePath) ? filePath : path.join(process.cwd(), filePath)
  if (!fs.existsSync(filePath)) {
    throw Error(commonRenderer.renderError(`File path '${originalPath}' not found. Please try again.`))
  }

  if (projectFilesToPath.has(filePath) || additionalFiles.has(filePath)) {
    throw Error(commonRenderer.renderSoftWarning(`File '${filePath}' has already been added.`))
  }

  return filePath
}

/**
 * Gets the LOG_STREAM_COUNT latest log stream names, sorted by last event time
 * @param cwlClient CloudWatch Logs client
 * @param logGroupName name of the log group
 * @returns an array of the last LOG_STREAM_COUNT log stream names or an empty array if no log streams are found
 * @throws Error if the log streams cannot be retrieved
 */
export const getLogStreamNames = async (cwlClient: CloudWatchLogsClient, logGroupName: string) => {
  const command = new DescribeLogStreamsCommand({
    logGroupName,
    limit: LOG_STREAM_COUNT,
    descending: true,
    orderBy: OrderBy.LastEventTime,
  })
  const response = await cwlClient.send(command)
  const logStreams = response.logStreams
  if (logStreams === undefined || logStreams.length === 0) {
    return []
  }

  const output: string[] = []
  for (const logStream of logStreams) {
    const logStreamName = logStream.logStreamName
    if (logStreamName) {
      output.push(logStreamName)
    }
  }

  // Reverse array so the oldest log is created first, so Support Staff can sort by creation time
  return output.reverse()
}

/**
 * Gets the log events for a log stream
 * @param cwlClient
 * @param logGroupName
 * @param logStreamName
 * @returns the log events or an empty array if no log events are found
 * @throws Error if the log events cannot be retrieved
 */
export const getLogEvents = async (cwlClient: CloudWatchLogsClient, logGroupName: string, logStreamName: string) => {
  const command = new GetLogEventsCommand({
    logGroupName,
    logStreamName,
  })

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
 * @returns a map of log stream names to log events or an empty map if no logs are found
 */
export const getAllLogs = async (region: string, functionName: string) => {
  const logs = new Map<string, OutputLogEvent[]>()
  const cwlClient = new CloudWatchLogsClient({region})
  if (functionName.startsWith('arn:aws')) {
    functionName = functionName.split(':')[6]
  }
  const logGroupName = `/aws/lambda/${functionName}`
  let logStreamNames: string[]
  try {
    logStreamNames = await getLogStreamNames(cwlClient, logGroupName)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    throw new Error(`Unable to get log streams: ${msg}`)
  }

  for (const logStreamName of logStreamNames) {
    let logEvents
    try {
      logEvents = await getLogEvents(cwlClient, logGroupName, logStreamName)
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
 * Write the function config to a file
 * @param filePath path to the file
 * @param data the data to write
 * @throws Error if the file cannot be written
 */
export const writeFile = (filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data)
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Unable to create function configuration file: ${err.message}`)
    }
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
    if (err instanceof Error) {
      throw Error(`Unable to zip the flare files: ${err.message}`)
    }
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

    if (axios.isAxiosError(err)) {
      const errResponse: string = (err.response?.data.error as string) ?? ''
      const errorMessage = err.message ?? ''

      throw Error(`Failed to send flare file to Datadog Support: ${errorMessage}. ${errResponse}\n`)
    }

    throw err
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('withLogs', Command.Boolean('--with-logs'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
