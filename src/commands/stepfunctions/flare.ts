import {CloudWatchLogsClient, OutputLogEvent} from '@aws-sdk/client-cloudwatch-logs'
import {
  DescribeStateMachineCommandOutput,
  ExecutionListItem,
  HistoryEvent,
  SFNClient,
  Tag,
} from '@aws-sdk/client-sfn'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import {Command, Option} from 'clipanion'

import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  FIPS_ENV_VAR,
  FIPS_IGNORE_ERROR_ENV_VAR,
} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'

export class StepFunctionsFlareCommand extends Command {
  public static paths = [['stepfunctions', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Gather state machine configuration, execution history, logs, and project files for Datadog support troubleshooting.',
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
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async validateInputs(): Promise<0 | 1> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getStateMachineConfiguration(
    sfnClient: SFNClient,
    stateMachineArn: string
  ): Promise<DescribeStateMachineCommandOutput> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getStateMachineTags(
    sfnClient: SFNClient,
    stateMachineArn: string
  ): Promise<Record<string, string>> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getRecentExecutions(
    sfnClient: SFNClient,
    stateMachineArn: string
  ): Promise<ExecutionListItem[]> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getExecutionHistory(
    sfnClient: SFNClient,
    executionArn: string
  ): Promise<HistoryEvent[]> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getLogSubscriptions(
    cloudWatchLogsClient: CloudWatchLogsClient,
    logGroupName: string
  ): Promise<any[]> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getCloudWatchLogs(
    cloudWatchLogsClient: CloudWatchLogsClient,
    logGroupName: string,
    startTime?: number,
    endTime?: number
  ): Promise<Map<string, OutputLogEvent[]>> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private maskStateMachineConfig(config: DescribeStateMachineCommandOutput): DescribeStateMachineCommandOutput {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private maskExecutionData(execution: any): any {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private generateInsightsFile(
    filePath: string,
    isDryRun: boolean,
    config: DescribeStateMachineCommandOutput
  ): void {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private summarizeConfig(config: DescribeStateMachineCommandOutput): any {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private getFramework(): string {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async createOutputDirectory(): Promise<string> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async writeOutputFiles(
    outputDir: string,
    data: {
      config: DescribeStateMachineCommandOutput
      tags: Record<string, string>
      executions: ExecutionListItem[]
      subscriptionFilters?: any[]
      logs?: Map<string, OutputLogEvent[]>
    }
  ): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async zipAndSend(outputDir: string): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private parseStateMachineArn(arn: string): {region: string; name: string} {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private getLogGroupName(config: DescribeStateMachineCommandOutput): string | undefined {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private maskAslDefinition(definition: string): string {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  private async getExecutionDetails(
    sfnClient: SFNClient,
    executionArn: string
  ): Promise<any> {
    // TODO: Implement
    throw new Error('Not implemented')
  }
}