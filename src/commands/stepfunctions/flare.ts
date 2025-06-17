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
import {Command, Option} from 'clipanion'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {createDirectories, writeFile, zipContents} from '../../helpers/fs'
import {version} from '../../helpers/version'

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
  private region = Option.String('-r,--region')
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

  public async execute(): Promise<0 | 1> {
    // Enable FIPS if configured
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    // Validate inputs
    const validationResult = await this.validateInputs()
    if (validationResult !== 0) {
      this.context.stdout.write(
        'Usage: datadog-ci stepfunctions flare -s <state-machine-arn> -c <case-id> -e <email>\n'
      )

      return 1
    }

    try {
      // Parse ARN to get region
      const {region} = this.parseStateMachineArn(this.stateMachineArn!)

      // Create AWS clients
      const sfnClient = new SFNClient({region, credentials: this.credentials})
      const cloudWatchLogsClient = new CloudWatchLogsClient({region, credentials: this.credentials})

      this.context.stdout.write(`\nCollecting Step Functions flare data...\n`)

      // 1. Get state machine configuration
      this.context.stdout.write('  - Fetching state machine configuration...\n')
      const stateMachineConfig = await this.getStateMachineConfiguration(sfnClient, this.stateMachineArn!)
      const maskedConfig = this.maskStateMachineConfig(stateMachineConfig)

      // 2. Get state machine tags
      this.context.stdout.write('  - Fetching state machine tags...\n')
      const tags = await this.getStateMachineTags(sfnClient, this.stateMachineArn!)

      // 3. Get recent executions
      this.context.stdout.write('  - Fetching recent executions...\n')

      const executions = await this.getRecentExecutions(sfnClient, this.stateMachineArn!)

      // Mask sensitive data in executions
      const maskedExecutions = executions.map((exec) => this.maskExecutionData(exec))

      // 4. Get execution details and history for each execution
      this.context.stdout.write('  - Fetching execution details and history...\n')

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

      // 5. Get CloudWatch logs if enabled
      let subscriptionFilters: SubscriptionFilter[] | undefined
      let logs: Map<string, OutputLogEvent[]> | undefined

      if (this.withLogs) {
        const logGroupName = this.getLogGroupName(stateMachineConfig)
        if (logGroupName) {
          this.context.stdout.write('  - Fetching CloudWatch logs...\n')

          // Get subscription filters
          subscriptionFilters = await this.getLogSubscriptions(cloudWatchLogsClient, logGroupName)

          // Get logs
          const startTime = this.start ? new Date(this.start).getTime() : undefined
          const endTime = this.end ? new Date(this.end).getTime() : undefined
          logs = await this.getCloudWatchLogs(cloudWatchLogsClient, logGroupName, startTime, endTime)
        }
      }

      // 6. Create output directory
      this.context.stdout.write('\nGenerating flare files...\n')
      const outputDir = await this.createOutputDirectory()

      // 7. Generate insights file
      const insightsPath = `${outputDir}/INSIGHTS.md`
      this.generateInsightsFile(insightsPath, this.isDryRun, maskedConfig)

      // 8. Write all output files
      await this.writeOutputFiles(outputDir, {
        config: maskedConfig,
        tags,
        executions: maskedExecutions,
        subscriptionFilters,
        logs,
      })

      // 9. Zip and send to Datadog
      if (!this.isDryRun) {
        this.context.stdout.write('\nCreating flare archive...\n')
        await this.zipAndSend(outputDir)
        this.context.stdout.write(`\nFlare created successfully: ${outputDir}.zip\n`)
      } else {
        this.context.stdout.write(`\n[Dry Run] Flare would be created at: ${outputDir}.zip\n`)
      }

      this.context.stdout.write('\nFlare data collection complete!\n')
      this.context.stdout.write(`Case ID: ${this.caseId}\n`)
      this.context.stdout.write(`Email: ${this.email}\n`)

      return 0
    } catch (error) {
      this.context.stderr.write(
        `\nError collecting flare data: ${error instanceof Error ? error.message : String(error)}\n`
      )

      return 1
    }
  }

  private async validateInputs(): Promise<0 | 1> {
    // Validate state machine ARN
    if (this.stateMachineArn === undefined) {
      return 1
    }

    // Validate ARN format
    const arnPattern = /^arn:aws:states:[a-z0-9-]+:\d{12}:stateMachine:[a-zA-Z0-9-_]+$/
    if (!arnPattern.test(this.stateMachineArn)) {
      return 1
    }

    // Extract and set region from ARN if not provided
    if (this.region === undefined && this.stateMachineArn) {
      try {
        const parsed = this.parseStateMachineArn(this.stateMachineArn)
        this.region = parsed.region
      } catch {
        return 1
      }
    }

    // Validate case ID
    if (this.caseId === undefined) {
      return 1
    }

    // Validate email
    if (this.email === undefined) {
      return 1
    }

    // Validate API key
    this.apiKey = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      return 1
    }

    return 0
  }

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

  private async getExecutionHistory(sfnClient: SFNClient, executionArn: string): Promise<HistoryEvent[]> {
    const command = new GetExecutionHistoryCommand({
      executionArn,
      includeExecutionData: true,
      maxResults: 500,
    })
    const response = await sfnClient.send(command)

    return response.events ?? []
  }

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

  private maskStateMachineConfig(config: DescribeStateMachineCommandOutput): DescribeStateMachineCommandOutput {
    const maskedConfig = {...config}

    if (maskedConfig.definition) {
      maskedConfig.definition = this.maskAslDefinition(maskedConfig.definition)
    }

    return maskedConfig
  }

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

  private generateInsightsFile(filePath: string, isDryRun: boolean, config: DescribeStateMachineCommandOutput): void {
    const summary = this.summarizeConfig(config)
    const framework = this.getFramework()
    const timestamp = new Date().toISOString()

    const content = `# Step Functions Flare Insights

Generated: ${timestamp}

## State Machine Configuration
- Name: ${summary.name}
- ARN: ${summary.stateMachineArn}
- Type: ${summary.type}
- Status: ${summary.status}

## Framework
${framework}

## Environment
- Region: ${this.region || 'Not specified'}
- CLI Version: ${version}
`

    if (!isDryRun) {
      writeFile(filePath, content)
    }
  }

  private summarizeConfig(config: DescribeStateMachineCommandOutput): any {
    return {
      stateMachineArn: config.stateMachineArn,
      name: config.name,
      type: config.type,
      status: config.status,
      creationDate: config.creationDate,
      loggingConfiguration: config.loggingConfiguration
        ? {
            level: config.loggingConfiguration.level,
            includeExecutionData: config.loggingConfiguration.includeExecutionData,
          }
        : undefined,
      roleArn: config.roleArn,
    }
  }

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

  private async createOutputDirectory(): Promise<string> {
    const timestamp = Date.now()
    const stateMachineName = this.parseStateMachineArn(this.stateMachineArn!).name
    const outputDir = `.datadog-ci/flare/stepfunctions-${stateMachineName}-${timestamp}`
    createDirectories(outputDir, [])

    return outputDir
  }

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
      createDirectories(outputDir, ['logs'])

      for (const [streamName, events] of data.logs) {
        const safeStreamName = streamName.replace(/[^a-zA-Z0-9-_]/g, '_')
        const logPath = `${logsDir}/${safeStreamName}.json`
        writeFile(logPath, JSON.stringify(events, undefined, 2))
      }
    }
  }

  private async zipAndSend(outputDir: string): Promise<void> {
    const zipPath = `${outputDir}.zip`
    await zipContents(outputDir, zipPath)
    // TODO: Implement actual sending to Datadog when sendToDatadog is available
    // For now, just create the zip file
  }

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

  private async getExecutionDetails(sfnClient: SFNClient, executionArn: string): Promise<any> {
    const command = new DescribeExecutionCommand({
      executionArn,
    })

    return sfnClient.send(command)
  }
}
