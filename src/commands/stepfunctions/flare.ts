import * as fs from 'fs'

import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  DescribeSubscriptionFiltersCommand,
  GetLogEventsCommand,
  OutputLogEvent,
  SubscriptionFilter,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  DescribeExecutionCommand,
  DescribeStateMachineCommand,
  DescribeStateMachineCommandOutput,
  ExecutionListItem,
  GetExecutionHistoryCommand,
  HistoryEvent,
  ListExecutionsCommand,
  ListTagsForResourceCommand,
  SFNClient,
} from '@aws-sdk/client-sfn'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  FIPS_ENV_VAR,
  FIPS_IGNORE_ERROR_ENV_VAR,
  FLARE_OUTPUT_DIRECTORY,
} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {sendToDatadog} from '../../helpers/flare'
import {createDirectories, deleteFolder, writeFile, zipContents} from '../../helpers/fs'
import {requestConfirmation} from '../../helpers/prompt'
import * as helpersRenderer from '../../helpers/renderer'
import {version} from '../../helpers/version'

import {getAWSCredentials} from '../lambda/functions/commons'

export class StepFunctionsFlareCommand extends Command {
  public static paths = [['stepfunctions', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description:
      'Gather state machine configuration, execution history, logs, and project files for Datadog support troubleshooting.',
  })

  // CLI Options
  private isDryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private withLogs = Option.Boolean('--with-logs', false)
  private stateMachineArn = Option.String('-s,--state-machine')
  private caseId = Option.String('-c,--case-id')
  private email = Option.String('-e,--email')
  private start = Option.String('--start')
  private end = Option.String('--end')
  private maxExecutions = Option.String('--max-executions', '10')

  private apiKey?: string
  private credentials?: AwsCredentialIdentity

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  /**
   * Entry point for the `stepfunctions flare` command.
   * Gathers state machine configuration, execution history, logs, and project files
   * for Datadog support troubleshooting.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute(): Promise<0 | 1> {
    // Enable FIPS if configured
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.context.stdout.write(helpersRenderer.renderFlareHeader('Step Functions', this.isDryRun))

    // Validate inputs
    const validationResult = await this.validateInputs()
    if (validationResult !== 0) {
      return validationResult
    }

    try {
      // Get AWS credentials
      this.context.stdout.write(chalk.bold('\n🔑\tGetting AWS credentials...\n'))
      try {
        this.credentials = await getAWSCredentials()
      } catch (err) {
        if (err instanceof Error) {
          this.context.stderr.write(helpersRenderer.renderError(err.message))
        }

        return 1
      }

      // Parse ARN to get region
      const {region} = this.parseStateMachineArn(this.stateMachineArn!)

      // Create AWS clients
      const sfnClient = new SFNClient({region, credentials: this.credentials})
      const cloudWatchLogsClient = new CloudWatchLogsClient({region, credentials: this.credentials})

      this.context.stdout.write(chalk.bold('\n🔍\tCollecting Step Functions flare data...\n'))

      // 1. Get state machine configuration
      this.context.stdout.write('📋\tFetching state machine configuration...\n')
      const stateMachineConfig = await this.getStateMachineConfiguration(sfnClient, this.stateMachineArn!)
      const maskedConfig = this.maskStateMachineConfig(stateMachineConfig)

      // 2. Get state machine tags
      this.context.stdout.write('🔖\tGetting resource tags...\n')
      const tags = await this.getStateMachineTags(sfnClient, this.stateMachineArn!)

      // 3. Get recent executions
      this.context.stdout.write('📊\tFetching recent executions...\n')

      const executions = await this.getRecentExecutions(sfnClient, this.stateMachineArn!)

      // Mask sensitive data in executions
      const maskedExecutions = executions.map((exec) => this.maskExecutionData(exec))

      // 4. Get execution details and history for each execution
      this.context.stdout.write('📜\tFetching execution details and history...\n')

      for (const execution of executions.slice(0, 5)) {
        // Limit to 5 most recent
        if (execution.executionArn) {
          const details = await this.getExecutionDetails(sfnClient, execution.executionArn)
          const maskedDetails = this.maskExecutionData(details)
          // Add details to execution object
          Object.assign(execution, maskedDetails)

          // Get execution history
          const history = await this.getExecutionHistory(sfnClient, execution.executionArn)
          ;(execution as any).history = history
        }
      }

      // 5. Get log subscription filters (always collected)
      let subscriptionFilters: SubscriptionFilter[] | undefined
      const logGroupName = this.getLogGroupName(stateMachineConfig)
      if (logGroupName) {
        this.context.stdout.write('🔍\tGetting log subscription filters...\n')
        subscriptionFilters = await this.getLogSubscriptions(cloudWatchLogsClient, logGroupName)
      }

      // 6. Get CloudWatch logs if enabled
      let logs: Map<string, OutputLogEvent[]> | undefined
      if (this.withLogs && logGroupName) {
        this.context.stdout.write('🌧️\tGetting CloudWatch logs...\n')
        const startTime = this.start ? new Date(this.start).getTime() : undefined
        const endTime = this.end ? new Date(this.end).getTime() : undefined
        logs = await this.getCloudWatchLogs(cloudWatchLogsClient, logGroupName, startTime, endTime)
      }

      // 7. Create output directory
      this.context.stdout.write(chalk.bold('\n💾\tSaving files...\n'))
      const outputDir = await this.createOutputDirectory()

      // 8. Generate insights file
      const insightsPath = `${outputDir}/INSIGHTS.md`
      this.generateInsightsFile(insightsPath, this.isDryRun, maskedConfig, subscriptionFilters)

      // 9. Write all output files
      await this.writeOutputFiles(outputDir, {
        config: maskedConfig,
        tags,
        executions: maskedExecutions,
        subscriptionFilters,
        logs,
      })

      // 10. Create zip archive
      const zipPath = `${outputDir}.zip`
      await zipContents(outputDir, zipPath)

      // 11. Send to Datadog or show dry-run message
      if (this.isDryRun) {
        this.context.stdout.write(
          '\n🚫 The flare files were not sent because the command was executed in dry run mode.\n'
        )
        this.context.stdout.write(`\nℹ️\tYour output files are located at: ${outputDir}\n`)
        this.context.stdout.write(`ℹ️\tZip file created at: ${zipPath}\n`)

        return 0
      }

      // Confirm before sending
      this.context.stdout.write('\n')
      const confirmSendFiles = await requestConfirmation(
        'Are you sure you want to send the flare file to Datadog Support?',
        false
      )

      if (!confirmSendFiles) {
        this.context.stdout.write('\n🚫\tThe flare files were not sent based on your selection.')
        this.context.stdout.write(`\nℹ️\tYour output files are located at: ${outputDir}\n`)
        this.context.stdout.write(`ℹ️\tZip file created at: ${zipPath}\n`)

        return 0
      }

      // Send to Datadog
      this.context.stdout.write(chalk.bold('\n🚀\tSending to Datadog Support...\n'))
      await sendToDatadog(zipPath, this.caseId!, this.email!, this.apiKey!, outputDir)
      this.context.stdout.write(chalk.bold('\n✅\tSuccessfully sent flare file to Datadog Support!\n'))

      // Delete contents
      deleteFolder(outputDir)
      fs.unlinkSync(zipPath)

      return 0
    } catch (error) {
      this.context.stderr.write(
        `\nError collecting flare data: ${error instanceof Error ? error.message : String(error)}\n`
      )

      return 1
    }
  }

  /**
   * Validates required inputs for the flare command
   * @returns 0 if all inputs are valid, 1 otherwise
   */
  private async validateInputs(): Promise<0 | 1> {
    const errorMessages: string[] = []

    // Validate state machine ARN
    if (this.stateMachineArn === undefined) {
      errorMessages.push(helpersRenderer.renderError('No state machine ARN specified. [-s,--state-machine]'))
    } else {
      // Validate ARN format
      const arnPattern = /^arn:aws:states:[a-z0-9-]+:\d{12}:stateMachine:[a-zA-Z0-9-_]+$/
      if (!arnPattern.test(this.stateMachineArn)) {
        errorMessages.push(helpersRenderer.renderError('Invalid state machine ARN format.'))
      }
    }

    // Validate case ID
    if (this.caseId === undefined) {
      errorMessages.push(helpersRenderer.renderError('No case ID specified. [-c,--case-id]'))
    }

    // Validate email
    if (this.email === undefined) {
      errorMessages.push(helpersRenderer.renderError('No email specified. [-e,--email]'))
    }

    // Validate API key
    this.apiKey = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      errorMessages.push(
        helpersRenderer.renderError(
          'No Datadog API key specified. Set an API key with the DATADOG_API_KEY environment variable.'
        )
      )
    }

    if (errorMessages.length > 0) {
      for (const message of errorMessages) {
        this.context.stderr.write(message)
      }

      return 1
    }

    return 0
  }

  /**
   * Fetches the state machine configuration from AWS
   * @param sfnClient Step Functions client
   * @param stateMachineArn ARN of the state machine
   * @returns State machine configuration
   */
  private async getStateMachineConfiguration(
    sfnClient: SFNClient,
    stateMachineArn: string
  ): Promise<DescribeStateMachineCommandOutput> {
    const command = new DescribeStateMachineCommand({
      stateMachineArn,
      includedData: 'ALL_DATA',
    })

    return sfnClient.send(command)
  }

  /**
   * Fetches tags associated with the state machine
   * @param sfnClient Step Functions client
   * @param stateMachineArn ARN of the state machine
   * @returns Map of tag keys to values
   */
  private async getStateMachineTags(sfnClient: SFNClient, stateMachineArn: string): Promise<Record<string, string>> {
    const command = new ListTagsForResourceCommand({
      resourceArn: stateMachineArn,
    })
    const response = await sfnClient.send(command)
    const tags: Record<string, string> = {}
    if (response.tags) {
      for (const tag of response.tags) {
        if (tag.key && tag.value) {
          tags[tag.key] = tag.value
        }
      }
    }

    return tags
  }

  /**
   * Fetches recent executions of the state machine
   * @param sfnClient Step Functions client
   * @param stateMachineArn ARN of the state machine
   * @returns List of recent executions
   */
  private async getRecentExecutions(sfnClient: SFNClient, stateMachineArn: string): Promise<ExecutionListItem[]> {
    // Handle both direct string values (from tests) and Option objects (from CLI)
    const maxExecutionsValue = typeof this.maxExecutions === 'string' ? this.maxExecutions : '10'
    const maxResults = parseInt(maxExecutionsValue, 10)
    const command = new ListExecutionsCommand({
      stateMachineArn,
      maxResults,
    })
    const response = await sfnClient.send(command)

    return response.executions ?? []
  }

  /**
   * Fetches the execution history for a specific execution
   * @param sfnClient Step Functions client
   * @param executionArn ARN of the execution
   * @returns List of history events
   */
  private async getExecutionHistory(sfnClient: SFNClient, executionArn: string): Promise<HistoryEvent[]> {
    const command = new GetExecutionHistoryCommand({
      executionArn,
      includeExecutionData: true,
      maxResults: 500,
    })
    const response = await sfnClient.send(command)

    return response.events ?? []
  }

  /**
   * Fetches CloudWatch log subscription filters for a log group
   * @param cloudWatchLogsClient CloudWatch Logs client
   * @param logGroupName Name of the log group
   * @returns List of subscription filters
   */
  private async getLogSubscriptions(
    cloudWatchLogsClient: CloudWatchLogsClient,
    logGroupName: string
  ): Promise<SubscriptionFilter[]> {
    try {
      const command = new DescribeSubscriptionFiltersCommand({
        logGroupName,
      })
      const response = await cloudWatchLogsClient.send(command)

      return response.subscriptionFilters ?? []
    } catch (error) {
      // If log group doesn't exist, return empty array
      if (error instanceof Error && error.message.includes('ResourceNotFoundException')) {
        return []
      }
      throw error
    }
  }

  /**
   * Fetches CloudWatch logs from a log group
   * @param cloudWatchLogsClient CloudWatch Logs client
   * @param logGroupName Name of the log group
   * @param startTime Start time in milliseconds (optional)
   * @param endTime End time in milliseconds (optional)
   * @returns Map of log stream names to their log events
   */
  private async getCloudWatchLogs(
    cloudWatchLogsClient: CloudWatchLogsClient,
    logGroupName: string,
    startTime?: number,
    endTime?: number
  ): Promise<Map<string, OutputLogEvent[]>> {
    const logs = new Map<string, OutputLogEvent[]>()

    // Get log streams
    const describeStreamsCommand = new DescribeLogStreamsCommand({
      logGroupName,
      orderBy: 'LastEventTime',
      descending: true,
      limit: 50,
    })
    const streamsResponse = await cloudWatchLogsClient.send(describeStreamsCommand)
    const logStreams = streamsResponse.logStreams ?? []

    // Get logs from each stream
    for (const stream of logStreams) {
      if (!stream.logStreamName) {
        continue
      }

      const getLogsCommand = new GetLogEventsCommand({
        logGroupName,
        logStreamName: stream.logStreamName,
        startTime,
        endTime,
        limit: 1000,
      })

      const logsResponse = await cloudWatchLogsClient.send(getLogsCommand)
      if (logsResponse.events && logsResponse.events.length > 0) {
        logs.set(stream.logStreamName, logsResponse.events)
      }
    }

    return logs
  }

  /**
   * Masks sensitive data in state machine configuration
   * @param config State machine configuration
   * @returns Configuration with sensitive data masked
   */
  private maskStateMachineConfig(config: DescribeStateMachineCommandOutput): DescribeStateMachineCommandOutput {
    const maskedConfig = {...config}

    if (maskedConfig.definition) {
      maskedConfig.definition = this.maskAslDefinition(maskedConfig.definition)
    }

    return maskedConfig
  }

  /**
   * Masks sensitive data in execution data
   * @param execution Execution data object
   * @returns Execution data with sensitive fields masked
   */
  private maskExecutionData(execution: any): any {
    const maskedExecution = {...execution}

    // Mask sensitive data in input and output
    if (maskedExecution.input) {
      maskedExecution.input = this.maskJsonString(maskedExecution.input)
    }

    if (maskedExecution.output) {
      maskedExecution.output = this.maskJsonString(maskedExecution.output)
    }

    return maskedExecution
  }

  private maskJsonString(jsonString: string): string {
    try {
      const data = JSON.parse(jsonString)
      const masked = this.maskSensitiveData(data)

      return JSON.stringify(masked, undefined, 2)
    } catch {
      // If not valid JSON, return as-is
      return jsonString
    }
  }

  private maskSensitiveData(data: any): any {
    if (typeof data !== 'object' || data === undefined) {
      return data
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.maskSensitiveData(item))
    }

    const masked: any = {}
    const sensitiveKeys = [
      'password',
      'secret',
      'token',
      'key',
      'apikey',
      'api_key',
      'access_token',
      'refresh_token',
      'private_key',
      'credential',
      'creditcard',
      'credit_card',
      'ssn',
      'cvv',
      'pin',
    ]

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        masked[key] = '[REDACTED]'
      } else {
        masked[key] = this.maskSensitiveData(value)
      }
    }

    return masked
  }

  /**
   * Generates the insights markdown file with state machine information
   * @param filePath Path to write the insights file
   * @param isDryRun Whether this is a dry run
   * @param config State machine configuration
   * @param subscriptionFilters CloudWatch log subscription filters (optional)
   */
  private generateInsightsFile(
    filePath: string,
    isDryRun: boolean,
    config: DescribeStateMachineCommandOutput,
    subscriptionFilters?: SubscriptionFilter[]
  ): void {
    const lines: string[] = []

    // Header
    lines.push('# Step Functions Flare Insights')
    lines.push('\n_Autogenerated file from `stepfunctions flare`_  ')
    if (isDryRun) {
      lines.push('_This command was run in dry mode._')
    }

    // State Machine Configuration
    lines.push('\n## State Machine Configuration')
    lines.push(`**Name**: \`${config.name || 'Unknown'}\`  `)
    lines.push(`**ARN**: \`${config.stateMachineArn || 'Unknown'}\`  `)
    lines.push(`**Type**: \`${config.type || 'Unknown'}\`  `)
    lines.push(`**Status**: \`${config.status || 'Unknown'}\`  `)
    lines.push(`**Role ARN**: \`${config.roleArn || 'Not specified'}\`  `)
    lines.push(`**Creation Date**: \`${config.creationDate?.toISOString() || 'Unknown'}\`  `)

    // Logging Configuration
    lines.push('\n**Logging Configuration**:')
    if (config.loggingConfiguration) {
      lines.push(`- Level: \`${config.loggingConfiguration.level || 'Not specified'}\``)
      lines.push(`- Include Execution Data: \`${config.loggingConfiguration.includeExecutionData || false}\``)
      if (config.loggingConfiguration.destinations?.length) {
        lines.push('- Destinations:')
        for (const dest of config.loggingConfiguration.destinations) {
          if (dest.cloudWatchLogsLogGroup?.logGroupArn) {
            lines.push(`  - CloudWatch Logs: \`${dest.cloudWatchLogsLogGroup.logGroupArn}\``)
          }
        }
      }
    } else {
      lines.push('- Logging not configured')
    }

    // Tracing Configuration
    lines.push('\n**Tracing Configuration**:')
    lines.push(`- X-Ray Tracing: \`${config.tracingConfiguration?.enabled ? 'Enabled' : 'Disabled'}\``)

    // Encryption Configuration
    if (config.encryptionConfiguration) {
      lines.push('\n**Encryption Configuration**:')
      lines.push(`- Type: \`${config.encryptionConfiguration.type || 'AWS_OWNED_KEY'}\``)
      if (config.encryptionConfiguration.kmsKeyId) {
        lines.push(`- KMS Key ID: \`${config.encryptionConfiguration.kmsKeyId}\``)
      }
    }

    // CLI Information
    lines.push('\n## CLI Information')
    lines.push(`**Run Location**: \`${process.cwd()}\`  `)
    lines.push(`**CLI Version**: \`${version}\`  `)
    const timeString = new Date().toISOString().replace('T', ' ').replace('Z', '') + ' UTC'
    lines.push(`**Timestamp**: \`${timeString}\`  `)
    lines.push(`**Framework**: \`${this.getFramework()}\``)

    // Command Options
    lines.push('\n## Command Options')
    const {region} = this.parseStateMachineArn(this.stateMachineArn!)
    lines.push(`**Region**: \`${region}\`  `)
    lines.push(`**Max Executions**: \`${typeof this.maxExecutions === 'string' ? this.maxExecutions : '10'}\`  `)
    lines.push(`**With Logs**: \`${this.withLogs ? 'Yes' : 'No'}\`  `)
    if (this.start || this.end) {
      lines.push(`**Time Range**: \`${this.start || 'Any'}\` to \`${this.end || 'Now'}\`  `)
    }

    // Log Subscription Filters
    if (subscriptionFilters && subscriptionFilters.length > 0) {
      lines.push('\n## Log Subscription Filters')
      lines.push(`**Total Filters**: ${subscriptionFilters.length}`)
      lines.push('')

      for (const filter of subscriptionFilters) {
        lines.push(`### ${filter.filterName || 'Unnamed Filter'}`)
        lines.push(`**Destination ARN**: \`${filter.destinationArn || 'Not specified'}\`  `)
        lines.push(`**Filter Pattern**: \`${filter.filterPattern || 'No pattern (all logs)'}\`  `)

        // Check if it might be a Datadog forwarder based on the destination ARN
        if (filter.destinationArn && filter.destinationArn.includes('datadog')) {
          lines.push('**Note**: This appears to be a Datadog forwarder')
        }

        if (filter.roleArn) {
          lines.push(`**Role ARN**: \`${filter.roleArn}\`  `)
        }

        lines.push('')
      }
    }

    writeFile(filePath, lines.join('\n'))
  }

  /**
   * Detects the deployment framework used in the current directory
   * @returns Framework name or 'Unknown'
   */
  private getFramework(): string {
    const files = fs.readdirSync(process.cwd())

    // Check for Serverless Framework
    if (files.includes('serverless.yml') || files.includes('serverless.yaml') || files.includes('serverless.json')) {
      return 'Serverless Framework'
    }

    // Check for AWS SAM
    if (files.includes('template.yaml') || files.includes('template.yml') || files.includes('samconfig.toml')) {
      return 'AWS SAM'
    }

    // Check for AWS CDK
    if (files.includes('cdk.json')) {
      return 'AWS CDK'
    }

    // Check for Terraform
    if (files.some((f) => f.endsWith('.tf'))) {
      return 'Terraform'
    }

    return 'Unknown'
  }

  /**
   * Creates the output directory structure for flare files
   * @returns Path to the created output directory
   */
  private async createOutputDirectory(): Promise<string> {
    const timestamp = Date.now()
    const stateMachineName = this.parseStateMachineArn(this.stateMachineArn!).name
    const outputDirName = `stepfunctions-${stateMachineName}-${timestamp}`
    const rootDir = FLARE_OUTPUT_DIRECTORY
    const outputDir = `${rootDir}/${outputDirName}`

    // Create root directory if it doesn't exist
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir)
    }

    // Clean up old stepfunctions flare directories and zip files
    const files = fs.readdirSync(rootDir)
    for (const file of files) {
      if (file.startsWith('stepfunctions-')) {
        const filePath = `${rootDir}/${file}`
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          deleteFolder(filePath)
        } else if (file.endsWith('.zip')) {
          fs.unlinkSync(filePath)
        }
      }
    }

    // Create the new directory
    createDirectories(outputDir, [])

    return outputDir
  }

  /**
   * Writes all collected data to output files
   * @param outputDir Directory to write files to
   * @param data Collected data to write
   */
  private async writeOutputFiles(
    outputDir: string,
    data: {
      config: DescribeStateMachineCommandOutput
      tags: Record<string, string>
      executions: ExecutionListItem[]
      subscriptionFilters?: SubscriptionFilter[]
      logs?: Map<string, OutputLogEvent[]>
    }
  ): Promise<void> {
    // Write state machine configuration
    const configPath = `${outputDir}/state_machine_config.json`
    writeFile(configPath, JSON.stringify(data.config, undefined, 2))

    // Write tags
    const tagsPath = `${outputDir}/tags.json`
    writeFile(tagsPath, JSON.stringify(data.tags, undefined, 2))

    // Write recent executions
    const executionsPath = `${outputDir}/recent_executions.json`
    writeFile(executionsPath, JSON.stringify(data.executions, undefined, 2))

    // Write subscription filters if present
    if (data.subscriptionFilters) {
      const filtersPath = `${outputDir}/log_subscription_filters.json`
      writeFile(filtersPath, JSON.stringify(data.subscriptionFilters, undefined, 2))
    }

    // Write logs if present
    if (data.logs && data.logs.size > 0) {
      const logsDir = `${outputDir}/logs`
      createDirectories(logsDir, [])

      for (const [streamName, events] of data.logs) {
        const safeStreamName = streamName.replace(/[^a-zA-Z0-9-_]/g, '_')
        const logPath = `${logsDir}/${safeStreamName}.json`
        writeFile(logPath, JSON.stringify(events, undefined, 2))
      }
    }
  }

  /**
   * Parses a state machine ARN to extract region and name
   * @param arn State machine ARN
   * @returns Object with region and name
   * @throws Error if ARN format is invalid
   */
  private parseStateMachineArn(arn: string): {region: string; name: string} {
    // ARN format: arn:aws:states:region:account:stateMachine:name
    const parts = arn.split(':')
    if (parts.length !== 7 || parts[0] !== 'arn' || parts[1] !== 'aws' || parts[2] !== 'states') {
      throw new Error('Invalid state machine ARN format')
    }

    return {
      region: parts[3],
      name: parts[6],
    }
  }

  /**
   * Extracts CloudWatch log group name from state machine configuration
   * @param config State machine configuration
   * @returns Log group name or undefined if not configured
   */
  private getLogGroupName(config: DescribeStateMachineCommandOutput): string | undefined {
    if (!config.loggingConfiguration || !config.loggingConfiguration.destinations) {
      return undefined
    }

    for (const destination of config.loggingConfiguration.destinations) {
      if (destination.cloudWatchLogsLogGroup && destination.cloudWatchLogsLogGroup.logGroupArn) {
        // Extract log group name from ARN
        // ARN format: arn:aws:logs:region:account:log-group:name
        const arnParts = destination.cloudWatchLogsLogGroup.logGroupArn.split(':')
        if (arnParts.length >= 6) {
          return arnParts[6]
        }
      }
    }

    return undefined
  }

  /**
   * Masks sensitive data in Amazon States Language definition
   * @param definition ASL definition as JSON string
   * @returns Masked ASL definition
   */
  private maskAslDefinition(definition: string): string {
    try {
      const asl = JSON.parse(definition)
      const maskedAsl = this.maskAslObject(asl)

      return JSON.stringify(maskedAsl, undefined, 2)
    } catch {
      // If not valid JSON, return as-is
      return definition
    }
  }

  private maskAslObject(obj: any): any {
    if (typeof obj !== 'object' || obj === undefined) {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.maskAslObject(item))
    }

    const masked: any = {}
    const sensitiveKeys = ['ApiKey', 'SecretToken', 'Password', 'DatabasePassword', 'Token', 'Secret']

    for (const [key, value] of Object.entries(obj)) {
      // Check if key contains sensitive data
      if (sensitiveKeys.some((sensitive) => key.includes(sensitive))) {
        masked[key] = '[REDACTED]'
      } else if (key === 'States' && typeof value === 'object') {
        // Recursively mask states
        masked[key] = this.maskAslObject(value)
      } else if (key === 'Parameters' && typeof value === 'object') {
        // Mask parameters object
        masked[key] = this.maskAslObject(value)
      } else {
        masked[key] = this.maskAslObject(value)
      }
    }

    return masked
  }

  /**
   * Fetches detailed information about a specific execution
   * @param sfnClient Step Functions client
   * @param executionArn ARN of the execution
   * @returns Execution details
   */
  private async getExecutionDetails(sfnClient: SFNClient, executionArn: string): Promise<any> {
    const command = new DescribeExecutionCommand({
      executionArn,
    })

    return sfnClient.send(command)
  }
}
