import {CloudWatchLogs, StepFunctions} from 'aws-sdk'
import {Command} from 'clipanion'

import {
  createLogGroup,
  enableStepFunctionLogs,
  getStepFunction,
  listStepFunctionTags,
  putSubscriptionFilter,
  tagLogGroup,
  tagStepFunction,
} from './aws'
import {displayChanges, applyChanges} from './changes'
import {
  buildArn,
  buildLogGroupName,
  buildSubscriptionFilterName,
  getStepFunctionLogGroupArn,
  isValidArn,
  parseArn,
} from './helpers'
import {
  CreateLogGroupRequest,
  PutSubscriptionFilterRequest,
  TagStepFunctionRequest,
  UpdateStepFunctionRequest,
} from './interfaces'

export class InstrumentStepFunctionsCommand extends Command {
  public static usage = Command.Usage({
    description: 'Subscribe Step Function Log Groups to a Datadog Forwarder',
    examples: [
      [
        'View and apply changes to subscribe a Step Function Log Group to a Datadog Forwarder',
        'datadog-ci step-functions instrument --step-function-arn arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder-arn arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service',
      ],
      [
        'View changes to subscribe a Step Function Log Group to a Datadog Forwarder',
        'datadog-ci step-functions instrument --step-function-arn arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder-arn arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service --dry-run',
      ],
      [
        'View and apply changes to subscribe multiple Step Function Log Groups to a Datadog Forwarder',
        'datadog-ci step-functions instrument --step-function-arn arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1 --step-function-arn arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2 --forwarder-arn arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --env dev --service example-service',
      ],
    ],
  })

  private dryRun = false
  private environment?: string
  private forwarderArn?: string
  private service?: string
  private stepFunctionArns: string[] = []

  public async execute() {
    let validationError = false
    if (typeof this.forwarderArn !== 'string') {
      this.context.stdout.write('[Error] --forwarder-arn is required\n')

      return 1
    } else if (!isValidArn(this.forwarderArn)) {
      this.context.stdout.write(`[Error] invalid arn format for --forwarder-arn ${this.forwarderArn}\n`)
      validationError = true
    }

    if (this.stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] must specify at least one --step-function-arn\n`)
      validationError = true
    }

    for (const stepFunctionArn of this.stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] invalid arn format for --step-function-arn ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    const requestsByStepFunction: {
      [stepFunctionArn: string]: (
        | CreateLogGroupRequest
        | PutSubscriptionFilterRequest
        | TagStepFunctionRequest
        | UpdateStepFunctionRequest
      )[]
    } = {}

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of this.stepFunctionArns) {
      requestsByStepFunction[stepFunctionArn] = []

      // use region from the step function arn to make requests to AWS
      const arnObject = parseArn(stepFunctionArn)
      const region = arnObject.region
      const cloudWatchLogsClient = new CloudWatchLogs({region})
      const stepFunctionsClient = new StepFunctions({region})

      const stepFunction = await getStepFunction(stepFunctionsClient, stepFunctionArn)
      const listStepFunctionTagsResponse = await listStepFunctionTags(stepFunctionsClient, stepFunctionArn)

      // if env and service tags are not already set on step function, set these tags using the values passed as parameters
      const stepFunctionTagsToAdd: {key: string; value: string}[] = []
      const hasEnvTag = listStepFunctionTagsResponse.tags?.some((tag) => tag.key === 'env')
      if (!hasEnvTag && typeof this.environment === 'string') {
        stepFunctionTagsToAdd.push({
          key: 'env',
          value: this.environment,
        })
      } else if (!hasEnvTag && this.environment === undefined) {
        this.context.stdout.write('[Error] --env is required when a Step Function has no env tag\n')

        return 1
      }

      if (
        !listStepFunctionTagsResponse.tags?.some((tag) => tag.key === 'service') &&
        typeof this.service === 'string'
      ) {
        stepFunctionTagsToAdd.push({
          key: 'service',
          value: this.service,
        })
      }

      if (stepFunctionTagsToAdd.length > 0) {
        const tagStepFunctionRequest = tagStepFunction(stepFunctionsClient, stepFunctionArn, stepFunctionTagsToAdd)
        requestsByStepFunction[stepFunctionArn].push(tagStepFunctionRequest)
      }

      const subscriptionFilterName = buildSubscriptionFilterName(stepFunction.name)

      const logLevel = stepFunction.loggingConfiguration?.level
      if (logLevel === 'OFF') {
        // if step function logging is disabled, create a log group, subscribe the forwarder to it, and enable step function logging to the created log group
        const logGroupName = buildLogGroupName(stepFunction.name, this.environment)
        const createLogGroupRequest = createLogGroup(cloudWatchLogsClient, logGroupName)
        requestsByStepFunction[stepFunctionArn].push(createLogGroupRequest)

        const putSubscriptionFilterRequest = putSubscriptionFilter(
          cloudWatchLogsClient,
          this.forwarderArn,
          subscriptionFilterName,
          logGroupName
        )
        requestsByStepFunction[stepFunctionArn].push(putSubscriptionFilterRequest)

        const logGroupArn = buildArn(
          arnObject.partition,
          'logs',
          arnObject.region,
          arnObject.accountId,
          'log-group',
          `${logGroupName}:*`
        )

        // IAM policy on step function role should already include log permissions
        const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction, logGroupArn)
        requestsByStepFunction[stepFunctionArn].push(enableStepFunctionLogsRequest)
      } else {
        // if step function logging is enabled, subscribe the forwarder to the log group in the step function logging config
        const logGroupArn = getStepFunctionLogGroupArn(stepFunction)
        const logGroupName = parseArn(logGroupArn).resourceName

        // update step function logging config to have logLevel `ALL` and includeExecutionData `true` if not already configured
        const includeExecutionData = stepFunction.loggingConfiguration?.includeExecutionData
        if (logLevel !== 'ALL' || !includeExecutionData) {
          const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction, logGroupArn)
          requestsByStepFunction[stepFunctionArn].push(enableStepFunctionLogsRequest)
        }

        const tagLogGroupRequest = tagLogGroup(cloudWatchLogsClient, logGroupName)
        requestsByStepFunction[stepFunctionArn].push(tagLogGroupRequest)

        const putSubscriptionFilterRequest = putSubscriptionFilter(
          cloudWatchLogsClient,
          this.forwarderArn,
          subscriptionFilterName,
          logGroupName
        )
        requestsByStepFunction[stepFunctionArn].push(putSubscriptionFilterRequest)
      }
    }

    // display changes that will be applied if dry run mode is disabled
    displayChanges(requestsByStepFunction, this.dryRun, this.context)

    // if dry run mode is disabled, apply changes by making requests to AWS
    if (!this.dryRun) {
      await applyChanges(requestsByStepFunction, this.context)
    }
  }
}

InstrumentStepFunctionsCommand.addPath('step-functions', 'instrument')

InstrumentStepFunctionsCommand.addOption('dryRun', Command.Boolean('-d,--dry-run'))
InstrumentStepFunctionsCommand.addOption('environment', Command.String('-e,--env'))
InstrumentStepFunctionsCommand.addOption('forwarderArn', Command.String('--forwarder-arn'))
InstrumentStepFunctionsCommand.addOption('service', Command.String('--service'))
InstrumentStepFunctionsCommand.addOption('stepFunctionArns', Command.Array('-s,--step-function-arn'))
