import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {IAMClient} from '@aws-sdk/client-iam'
import {SFNClient} from '@aws-sdk/client-sfn'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {Command, Option} from 'clipanion'

import {cliVersion} from '../../version'

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
import {DD_TRACE_ENABLED, TAG_VERSION_NAME} from './constants'
import {
  buildLogGroupName,
  buildArn,
  buildSubscriptionFilterName,
  isValidArn,
  parseArn,
  getStepFunctionLogGroupArn,
  injectContextIntoTasks,
} from './helpers'

export class InstrumentStepFunctionsCommand extends Command {
  public static paths = [['stepfunctions', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Subscribe Step Function log groups to a Datadog Forwarder.',
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

  private dryRun = Option.Boolean('-d,--dry-run', false)
  private environment = Option.String('-e,--env')
  private forwarderArn = Option.String('--forwarder')
  private service = Option.String('--service')
  private stepFunctionArns = Option.Array('-s,--step-function')
  private mergeStepFunctionAndLambdaTraces = Option.Boolean(
    '-mlt,--merge-lambda-traces,--merge-step-function-and-lambda-traces',
    false
  )
  private propagateUpstreamTrace = Option.Boolean('--propagate-upstream-trace', false)

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<0 | 1> {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    let validationError = false
    if (typeof this.forwarderArn !== 'string') {
      this.context.stdout.write('[Error] `--forwarder` is required\n')
      validationError = true
    } else if (!isValidArn(this.forwarderArn)) {
      this.context.stdout.write(`[Error] Invalid arn format for \`--forwarder\` ${this.forwarderArn}\n`)
      validationError = true
    }

    if (validationError) {
      return 1
    }

    // remove duplicate step function arns
    const stepFunctionArns = [...new Set(this.stepFunctionArns)]

    if (stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] Must specify at least one \`--step-function\`\n`)
      validationError = true
    }

    for (const stepFunctionArn of stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] Invalid arn format for \`--step-function\` ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    let hasChanges = false

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of stepFunctionArns) {
      this.context.stdout.write(
        `\n======= ${this.dryRun ? '[Dry Run] Planning for' : 'For'} ${stepFunctionArn} =========\n`
      )
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
        !listStepFunctionTagsResponse?.tags?.some((tag) => tag.key === 'service' && tag.value === this.service) &&
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

      if (
        !listStepFunctionTagsResponse?.tags?.some(
          (tag) => tag.key === DD_TRACE_ENABLED && tag.value?.toLowerCase() === 'true'
        )
      ) {
        stepFunctionTagsToAdd.push({key: DD_TRACE_ENABLED, value: 'true'})
      }

      if (stepFunctionTagsToAdd.length > 0) {
        try {
          await tagResource(stepFunctionsClient, stepFunctionArn, stepFunctionTagsToAdd, this.context, this.dryRun)
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(`\n[Error] ${err.message}. Failed to tag resource for ${stepFunctionArn}\n`)
          }

          return 1
        }

        hasChanges = true
      }

      const stateMachineName = describeStateMachineCommandOutput.name!
      const subscriptionFilterName = buildSubscriptionFilterName(stateMachineName)

      const logLevel = describeStateMachineCommandOutput.loggingConfiguration?.level

      if (logLevel === 'OFF') {
        // if step function logging is disabled, create a log group, subscribe the forwarder to it, and enable step function logging to the created log group
        const logGroupName = buildLogGroupName(stateMachineName, this.environment)
        try {
          await createLogGroup(cloudWatchLogsClient, logGroupName, stepFunctionArn, this.context, this.dryRun)
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to Create Log Group ${logGroupName} for ${stepFunctionArn}\n`
            )
          }

          return 1
        }

        try {
          await putSubscriptionFilter(
            cloudWatchLogsClient,
            this.forwarderArn!,
            subscriptionFilterName,
            logGroupName,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to put subscription filter ${subscriptionFilterName} for Log Group ${logGroupName}\n`
            )
          }

          return 1
        }

        const logGroupArn = buildArn(
          arnObject.partition,
          'logs',
          arnObject.region,
          arnObject.accountId,
          'log-group',
          `${logGroupName}:*`
        )

        // Create Logs Access policy
        try {
          await createLogsAccessPolicy(
            iamClient,
            describeStateMachineCommandOutput,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to create logs access policy for ${stepFunctionArn}\n`
            )
          }

          return 1
        }

        // Attach policy to state machine IAM role
        try {
          await attachPolicyToStateMachineIamRole(
            iamClient,
            describeStateMachineCommandOutput,
            arnObject.accountId,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to attach policy to state machine iam role for ${stepFunctionArn}\n`
            )
          }

          return 1
        }

        // IAM policy on step function role should include log permissions now
        try {
          await enableStepFunctionLogs(
            stepFunctionsClient,
            describeStateMachineCommandOutput,
            logGroupArn,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to enable log group ${logGroupArn} for ${stepFunctionArn}\n`
            )
          }

          return 1
        }

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
          try {
            await enableStepFunctionLogs(
              stepFunctionsClient,
              describeStateMachineCommandOutput,
              logGroupArn,
              stepFunctionArn,
              this.context,
              this.dryRun
            )
          } catch (err) {
            if (err instanceof Error) {
              this.context.stdout.write(
                `\n[Error] ${err.message}. Failed to enable step function logs for ${stepFunctionArn} when logLevel is not ALL or includeExecutionData is not true\n`
              )
            }

            return 1
          }
          hasChanges = true
        }

        try {
          await putSubscriptionFilter(
            cloudWatchLogsClient,
            this.forwarderArn!,
            subscriptionFilterName,
            logGroupName,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        } catch (err) {
          if (err instanceof Error) {
            this.context.stdout.write(
              `\n[Error] ${err.message}. Failed to put subscription filter ${subscriptionFilterName} for ${stepFunctionArn}\n`
            )
          }

          return 1
        }
        hasChanges = true
      }

      if (this.mergeStepFunctionAndLambdaTraces || this.propagateUpstreamTrace) {
        // Not putting the update operation into the business logic of logs subscription. This will
        // add additional API call, but it would also allow easier testing and cleaner code.
        await injectContextIntoTasks(describeStateMachineCommandOutput, stepFunctionsClient, this.context, this.dryRun)
      }
    }
    if (!hasChanges) {
      this.context.stdout.write(`\nNo change is applied.\n `)
    }

    return 0
  }
}
