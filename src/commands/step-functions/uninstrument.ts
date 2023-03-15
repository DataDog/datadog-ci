import {CloudWatchLogs, StepFunctions} from 'aws-sdk'
import {Command} from 'clipanion'

import {deleteSubscriptionFilter, getStepFunction, listSubscriptionFilters, untagLogGroup} from './aws'
import {displayChanges, applyChanges} from './changes'
import {getStepFunctionLogGroupArn, isValidArn, parseArn} from './helpers'
import {DeleteSubscriptionFilterRequest, UntagLogGroupRequest, UpdateStepFunctionRequest} from './interfaces'

export class UninstrumentStepFunctionsCommand extends Command {
  public static usage = Command.Usage({
    description: 'Unubscribe Step Function Log Groups from a Datadog Forwarder',
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

      return 1
    } else if (!isValidArn(this.forwarderArn)) {
      this.context.stdout.write(`[Error] invalid arn format for --forwarder ${this.forwarderArn}\n`)
      validationError = true
    }

    if (this.stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] must specify at least one --step-function\n`)
      validationError = true
    }

    for (const stepFunctionArn of this.stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] invalid arn format for --step-function ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    const requestsByStepFunction: {
      [stepFunctionArn: string]: (DeleteSubscriptionFilterRequest | UntagLogGroupRequest | UpdateStepFunctionRequest)[]
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

      // the log group that should be unsubscribed from the forwarder is parsed from the step function logging config
      const logGroupArn = getStepFunctionLogGroupArn(stepFunction)
      const logGroupName = parseArn(logGroupArn).resourceName

      const untagLogGroupRequest = untagLogGroup(cloudWatchLogsClient, logGroupName)
      requestsByStepFunction[stepFunctionArn].push(untagLogGroupRequest)

      // delete subscription filters that are subscribed to the specified forwarder
      const listSubscriptionFiltersResponse = await listSubscriptionFilters(cloudWatchLogsClient, logGroupName)
      const subscriptionFilters =
        listSubscriptionFiltersResponse.subscriptionFilters?.filter(
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
    }

    // display changes that will be applied if dry run mode is disabled
    displayChanges(requestsByStepFunction, this.dryRun, this.context)

    // if dry run mode is disabled, apply changes by making requests to AWS
    if (!this.dryRun) {
      await applyChanges(requestsByStepFunction, this.context)
    }
  }
}

UninstrumentStepFunctionsCommand.addPath('step-functions', 'uninstrument')

UninstrumentStepFunctionsCommand.addOption('dryRun', Command.Boolean('-d,--dry-run'))
UninstrumentStepFunctionsCommand.addOption('forwarderArn', Command.String('--forwarder'))
UninstrumentStepFunctionsCommand.addOption('stepFunctionArns', Command.Array('-s,--step-function'))
