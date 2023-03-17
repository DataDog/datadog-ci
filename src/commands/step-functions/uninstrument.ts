import {CloudWatchLogs, StepFunctions} from 'aws-sdk'
import {Command} from 'clipanion'

import {deleteSubscriptionFilter, describeStateMachine, describeSubscriptionFilters, untagResource} from './aws'
import {displayChanges, applyChanges} from './changes'
import {TAG_VERSION_NAME} from './constants'
import {getStepFunctionLogGroupArn, isValidArn, parseArn} from './helpers'
import {RequestsByStepFunction} from './interfaces'

export class UninstrumentStepFunctionsCommand extends Command {
  public static usage = Command.Usage({
    description: 'Unubscribe Step Function Log Groups from a Datadog Forwarder',
    details: '--step-function expects a Step Function ARN\n--forwarder expects a Lambda ARN',
    examples: [
      [
        'View and apply changes to unsubscribe a Step Function Log Group from a Datadog Forwarder',
        'datadog-ci step-functions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder',
      ],
      [
        'View changes to unsubscribe a Step Function Log Group from a Datadog Forwarder',
        'datadog-ci step-functions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder --dry-run',
      ],
      [
        'View and apply changes to unsubscribe multiple Step Function Log Groups from a Datadog Forwarder',
        'datadog-ci step-functions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1 --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2 --forwarder arn:aws:lambda:us-east-1:000000000000:function:ExampleDatadogForwarder',
      ],
    ],
  })

  private dryRun = false
  private forwarderArn!: string
  private stepFunctionArns: string[] = []

  public async execute() {
    let validationError = false
    if (typeof this.forwarderArn !== 'string') {
      this.context.stdout.write('[Error] --forwarder is required\n')
      validationError = true
    } else if (!isValidArn(this.forwarderArn)) {
      this.context.stdout.write(`[Error] invalid arn format for --forwarder ${this.forwarderArn}\n`)
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

    const requestsByStepFunction: RequestsByStepFunction = {}

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of this.stepFunctionArns) {
      requestsByStepFunction[stepFunctionArn] = []

      // use region from the step function arn to make requests to AWS
      const arnObject = parseArn(stepFunctionArn)
      const region = arnObject.region
      const cloudWatchLogsClient = new CloudWatchLogs({region})
      const stepFunctionsClient = new StepFunctions({region})

      let stepFunction
      try {
        stepFunction = await describeStateMachine(stepFunctionsClient, stepFunctionArn)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(`\n[Error] ${err.message}. Unable to fetch Step Function ${stepFunctionArn}\n`)
        } else {
          this.context.stdout.write(`\n[Error] ${err}. Unable to fetch Step Function ${stepFunctionArn}\n`)
        }

        return 1
      }

      // the log group that should be unsubscribed from the forwarder is parsed from the step function logging config
      const logGroupArn = getStepFunctionLogGroupArn(stepFunction)
      if (logGroupArn === undefined) {
        this.context.stdout.write('\n[Error] Unable to get log group arn from Step Function logging configuration\n')

        return 1
      }
      const logGroupName = parseArn(logGroupArn).resourceName

      // delete subscription filters that are subscribed to the specified forwarder
      let describeSubscriptionFiltersResponse: CloudWatchLogs.DescribeSubscriptionFiltersResponse | undefined
      try {
        describeSubscriptionFiltersResponse = await describeSubscriptionFilters(cloudWatchLogsClient, logGroupName)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(
            `\n[Error] ${err.message}. Unable to fetch subscription filter to delete for Log Group ${logGroupName}\n`
          )
        } else {
          this.context.stdout.write(
            `\n[Error] ${err}. Unable to fetch subscription filter to delete for Log Group ${logGroupName}\n`
          )
        }

        return 1
      }

      const subscriptionFilters =
        describeSubscriptionFiltersResponse.subscriptionFilters?.filter(
          (subscriptionFilter) => subscriptionFilter.destinationArn === this.forwarderArn
        ) ?? []

      for (const subscriptionFilter of subscriptionFilters) {
        if (typeof subscriptionFilter.filterName === 'string') {
          const deleteSubscriptionFilterRequest = deleteSubscriptionFilter(
            cloudWatchLogsClient,
            subscriptionFilter.filterName,
            logGroupName
          )
          requestsByStepFunction[stepFunctionArn].push(deleteSubscriptionFilterRequest)
        }
      }

      const tagKeystoRemove: StepFunctions.TagKeyList = [TAG_VERSION_NAME]
      const untagStepFunctionRequest = untagResource(stepFunctionsClient, stepFunctionArn, tagKeystoRemove)
      requestsByStepFunction[stepFunctionArn].push(untagStepFunctionRequest)
    }

    if (Object.keys(requestsByStepFunction).length === 0) {
      this.context.stdout.write('No changes to apply')

      return 0
    }

    // display changes that will be applied if dry run mode is disabled
    displayChanges(requestsByStepFunction, this.dryRun, this.context)

    // if dry run mode is disabled, apply changes by making requests to AWS
    if (!this.dryRun) {
      const error = await applyChanges(requestsByStepFunction, this.context)
      if (error) {
        return 1
      }
    }

    return 0
  }
}

UninstrumentStepFunctionsCommand.addPath('step-functions', 'uninstrument')

UninstrumentStepFunctionsCommand.addOption('dryRun', Command.Boolean('-d,--dry-run'))
UninstrumentStepFunctionsCommand.addOption('forwarderArn', Command.String('--forwarder'))
UninstrumentStepFunctionsCommand.addOption('stepFunctionArns', Command.Array('-s,--step-function'))
