import {CloudWatchLogsClient, DescribeSubscriptionFiltersCommandOutput} from '@aws-sdk/client-cloudwatch-logs'
import {SFNClient} from '@aws-sdk/client-sfn'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {Command, Option} from 'clipanion'

import {deleteSubscriptionFilter, describeStateMachine, describeSubscriptionFilters, untagResource} from './awsCommands'
import {DD_CI_IDENTIFYING_STRING, TAG_VERSION_NAME} from './constants'
import {getStepFunctionLogGroupArn, isValidArn, parseArn} from './helpers'

export class UninstrumentStepFunctionsCommand extends Command {
  public static paths = [['stepfunctions', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Remove Step Function log groups subscription filter created by datadog-ci.',
    details: '--stepfunction expects a Step Function ARN',
    examples: [
      [
        'View and apply changes to remove Step Functions log groups subscription filters created by datadog-ci',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ],
      [
        'View changes to remove Step Functions log groups subscription filters created by datadog-ci',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --dry-run',
      ],
      [
        'View and apply changes to remove Step Functions log groups subscription filters created by datadog-ci',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1 --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2',
      ],
    ],
  })

  private dryRun = Option.Boolean('-d,--dry-run', false)
  private stepFunctionArns = Option.Array('-s,--step-function')

  // The options below are to match what InstrumentStepFunctionsCommand has so that customers can switch from instrument to uninstrument.
  // Lambda command adopts the same approach as well.
  private environment = Option.String('-e,--env', {hidden: true})
  private forwarderArn = Option.String('--forwarder', {hidden: true})
  private service = Option.String('--service', {hidden: true})
  private mergeStepFunctionAndLambdaTraces = Option.Boolean(
    '-mlt,--merge-lambda-traces,--merge-step-function-and-lambda-traces',
    false,
    {hidden: true}
  )

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    let validationError = false
    let hasChanges = false

    // remove duplicate step function arns
    const stepFunctionArns = [...new Set(this.stepFunctionArns)]

    if (stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] must specify at least one \`--step-function\`\n`)
      validationError = true
    }

    for (const stepFunctionArn of stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] invalid arn format for \`--step-function\` ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of stepFunctionArns) {
      // use region from the step function arn to make requests to AWS
      const arnObject = parseArn(stepFunctionArn)
      const region = arnObject.region
      const cloudWatchLogsClient = new CloudWatchLogsClient({region})
      const stepFunctionsClient = new SFNClient({region})

      let describeStateMachineCommandOutput
      try {
        describeStateMachineCommandOutput = await describeStateMachine(stepFunctionsClient, stepFunctionArn)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(`\n[Error] ${err.message}. Unable to fetch Step Function ${stepFunctionArn}\n`)
        }

        return 1
      }

      const logGroupArn = getStepFunctionLogGroupArn(describeStateMachineCommandOutput)
      if (logGroupArn === undefined) {
        this.context.stdout.write('\n[Error] Unable to get Log Group arn from Step Function logging configuration\n')

        return 1
      }
      const logGroupName = parseArn(logGroupArn).resourceName

      // delete subscription filters that are created by datadog-ci
      let describeSubscriptionFiltersResponse: DescribeSubscriptionFiltersCommandOutput | undefined
      try {
        describeSubscriptionFiltersResponse = await describeSubscriptionFilters(cloudWatchLogsClient, logGroupName)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(
            `\n[Error] ${err.message}. Unable to fetch Subscription Filter to delete for Log Group ${logGroupName}\n`
          )
        }

        return 1
      }
      const subscriptionFilters =
        describeSubscriptionFiltersResponse.subscriptionFilters?.filter((subscriptionFilter) =>
          subscriptionFilter.filterName?.includes(DD_CI_IDENTIFYING_STRING)
        ) ?? []

      for (const subscriptionFilter of subscriptionFilters) {
        if (typeof subscriptionFilter.filterName === 'string') {
          try {
            await deleteSubscriptionFilter(
              cloudWatchLogsClient,
              subscriptionFilter.filterName,
              logGroupName,
              stepFunctionArn,
              this.context,
              this.dryRun
            )
          } catch (err) {
            if (err instanceof Error) {
              this.context.stdout.write(
                `\n[Error] ${err.message}. Failed to delete subscription filter ${subscriptionFilter.filterName}\n`
              )
            }

            return 1
          }

          hasChanges = true
        }
      }

      const tagKeysToRemove: string[] = [TAG_VERSION_NAME]
      // Untag resource command is idempotent, no need to verify if the tag exist by making an additional api call to get tags
      try {
        await untagResource(stepFunctionsClient, tagKeysToRemove, stepFunctionArn, this.context, this.dryRun)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(`\n[Error] ${err.message}. Failed to untag resource for ${stepFunctionArn}\n`)
        }

        return 1
      }
    }

    if (!hasChanges) {
      this.context.stdout.write(`\nNo change is applied.\n`)
    }

    return 0
  }
}
