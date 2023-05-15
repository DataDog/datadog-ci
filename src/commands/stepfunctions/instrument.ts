import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {IAMClient} from '@aws-sdk/client-iam'
import {SFNClient} from '@aws-sdk/client-sfn'
import {Command} from 'clipanion'

import {
  createLogGroup,
  enableStepFunctionLogs,
  describeStateMachine,
  listTagsForResource,
  putSubscriptionFilter,
  tagResource,
  attachPolicyToStateMachineIamRole,
  createLogsAccessPolicy,
} from './awsCommands'
import {TAG_VERSION_NAME} from './constants'
import {
  buildLogGroupName,
  buildArn,
  buildSubscriptionFilterName,
  isValidArn,
  parseArn,
  getStepFunctionLogGroupArn,
} from './helpers'

const cliVersion = require('../../../package.json').version

export class InstrumentStepFunctionsCommand extends Command {
  public static usage = Command.Usage({
    description: 'Subscribe Step Function Log Groups to a Datadog Forwarder',
    details: '--step-function expects a Step Function ARN\n--forwarder expects a Lambda ARN',
    examples: [
      [
        'View and apply changes to subscribe a Step Function Log Group to a Datadog Forwarder',
        'datadog-ci stepfunctions instrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service',
      ],
      [
        'View changes to subscribe a Step Function Log Group to a Datadog Forwarder',
        'datadog-ci stepfunctions instrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service --dry-run',
      ],
      [
        'View and apply changes to subscribe multiple Step Function Log Groups to a Datadog Forwarder',
        'datadog-ci stepfunctions instrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1 --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2 --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service',
      ],
    ],
  })

  private dryRun = false
  private environment?: string
  private forwarderArn!: string
  private service?: string
  private stepFunctionArns: string[] = []

  public async execute() {
    let validationError = false
    if (typeof this.forwarderArn !== 'string') {
      this.context.stdout.write('[Error] `--forwarder` is required\n')
      validationError = true
    } else if (!isValidArn(this.forwarderArn)) {
      this.context.stdout.write(`[Error] Invalid arn format for \`--forwarder\` ${this.forwarderArn}\n`)
      validationError = true
    }

    // remove duplicate step function arns
    const stepFunctionArns = [...new Set(this.stepFunctionArns)]

    if (stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] must specify at least one --step-function\n`)
      validationError = true
    }

    for (const stepFunctionArn of stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] invalid arn format for --step-function ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    let hasChanges = false

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of stepFunctionArns) {
      // use region from the step function arn to make requests to AWS
      const arnObject = parseArn(stepFunctionArn)
      const region = arnObject.region
      const cloudWatchLogsClient = new CloudWatchLogsClient({region})
      const stepFunctionsClient = new SFNClient({region})
      const iamClient = new IAMClient({region})

      let describeStateMachineCommandOutput
      try {
        describeStateMachineCommandOutput = await describeStateMachine(stepFunctionsClient, stepFunctionArn)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(`\n[Error] ${err.message}. Unable to describe state machine ${stepFunctionArn}\n`)
        } else {
          this.context.stdout.write(`\n[Error] ${err}. Unable to describe state machine ${stepFunctionArn}\n`)
        }

        return 1
      }

      let listStepFunctionTagsResponse
      try {
        listStepFunctionTagsResponse = await listTagsForResource(stepFunctionsClient, stepFunctionArn)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(
            `\n[Error] ${err.message}. Unable to fetch tags for Step Function ${stepFunctionArn}\n`
          )
        } else {
          this.context.stdout.write(`\n[Error] ${err}. Unable to fetch tags for Step Function ${stepFunctionArn}\n`)
        }

        return 1
      }

      const stepFunctionTagsToAdd = []

      // if env and service tags are not already set on step function, set these tags using the values passed as parameters
      const hasEnvTag = listStepFunctionTagsResponse?.tags?.some((tag) => tag.key === 'env')
      if (!hasEnvTag && typeof this.environment === 'string') {
        stepFunctionTagsToAdd.push({
          key: 'env',
          value: this.environment,
        })
      } else if (!hasEnvTag && this.environment === undefined) {
        this.context.stdout.write('\n[Error] --env is required when a Step Function has no env tag\n')

        return 1
      }

      if (
        !listStepFunctionTagsResponse?.tags?.some((tag) => tag.key === 'service') &&
        typeof this.service === 'string'
      ) {
        stepFunctionTagsToAdd.push({key: 'service', value: this.service})
      }

      // set version tag if it changed
      if (
        !listStepFunctionTagsResponse?.tags?.some(
          (tag) => tag.key === TAG_VERSION_NAME && tag.value === `v${cliVersion}`
        )
      ) {
        stepFunctionTagsToAdd.push({key: TAG_VERSION_NAME, value: `v${cliVersion}`})
      }

      if (stepFunctionTagsToAdd.length > 0) {
        await tagResource(stepFunctionsClient, stepFunctionArn, stepFunctionTagsToAdd, this.context, this.dryRun)
        hasChanges = true
      }

      const stateMachineName = describeStateMachineCommandOutput.name!
      const subscriptionFilterName = buildSubscriptionFilterName(stateMachineName)

      const logLevel = describeStateMachineCommandOutput.loggingConfiguration?.level

      if (logLevel === 'OFF') {
        // if step function logging is disabled, create a log group, subscribe the forwarder to it, and enable step function logging to the created log group
        const logGroupName = buildLogGroupName(stateMachineName, this.environment)
        await createLogGroup(cloudWatchLogsClient, logGroupName, stepFunctionArn, this.context, this.dryRun)

        await putSubscriptionFilter(
          cloudWatchLogsClient,
          this.forwarderArn,
          subscriptionFilterName,
          logGroupName,
          stepFunctionArn,
          this.context,
          this.dryRun
        )

        const logGroupArn = buildArn(
          arnObject.partition,
          'logs',
          arnObject.region,
          arnObject.accountId,
          'log-group',
          `${logGroupName}:*`
        )

        // Create Logs Access policy
        await createLogsAccessPolicy(
          iamClient,
          describeStateMachineCommandOutput,
          stepFunctionArn,
          this.context,
          this.dryRun
        )

        // Attach policy to state machine IAM role
        await attachPolicyToStateMachineIamRole(
          iamClient,
          describeStateMachineCommandOutput,
          arnObject.accountId,
          stepFunctionArn,
          this.context,
          this.dryRun
        )

        // IAM policy on step function role should include log permissions now
        await enableStepFunctionLogs(
          stepFunctionsClient,
          describeStateMachineCommandOutput,
          logGroupArn,
          stepFunctionArn,
          this.context,
          this.dryRun
        )
        hasChanges = true
      } else {
        // if step function logging is enabled, subscribe the forwarder to the log group in the step function logging config
        const logGroupArn = getStepFunctionLogGroupArn(describeStateMachineCommandOutput)
        if (logGroupArn === undefined) {
          this.context.stdout.write('\n[Error] Unable to get Log Group arn from Step Function logging configuration\n')

          return 1
        }
        const logGroupName = parseArn(logGroupArn).resourceName

        // update step function logging config to have logLevel `ALL` and includeExecutionData `true` if not already configured
        const includeExecutionData = describeStateMachineCommandOutput.loggingConfiguration?.includeExecutionData
        if (logLevel !== 'ALL' || !includeExecutionData) {
          await enableStepFunctionLogs(
            stepFunctionsClient,
            describeStateMachineCommandOutput,
            logGroupArn,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
          hasChanges = true
        }
        await putSubscriptionFilter(
          cloudWatchLogsClient,
          this.forwarderArn,
          subscriptionFilterName,
          logGroupName,
          stepFunctionArn,
          this.context,
          this.dryRun
        )
        hasChanges = true
      }
    }
    if (!hasChanges) {
      this.context.stdout.write(`\nNo change is applied.\n `)
    }

    return 0
  }
}

InstrumentStepFunctionsCommand.addPath('stepfunctions', 'instrument')

InstrumentStepFunctionsCommand.addOption('dryRun', Command.Boolean('-d,--dry-run'))
InstrumentStepFunctionsCommand.addOption('environment', Command.String('-e,--env'))
InstrumentStepFunctionsCommand.addOption('forwarderArn', Command.String('--forwarder'))
InstrumentStepFunctionsCommand.addOption('service', Command.String('--service'))
InstrumentStepFunctionsCommand.addOption('stepFunctionArns', Command.Array('-s,--step-function'))
