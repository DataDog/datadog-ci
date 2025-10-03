import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class StepfunctionsInstrumentCommand extends BaseCommand {
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

  protected dryRun = Option.Boolean('-d,--dry-run', false)
  protected environment = Option.String('-e,--env')
  protected forwarderArn = Option.String('--forwarder')
  protected service = Option.String('--service')
  protected stepFunctionArns = Option.Array('-s,--step-function')
  protected mergeStepFunctionAndLambdaTraces = Option.Boolean(
    '-mlt,--merge-lambda-traces,--merge-step-function-and-lambda-traces',
    false
  )
  protected propagateUpstreamTrace = Option.Boolean('--propagate-upstream-trace', false)

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
