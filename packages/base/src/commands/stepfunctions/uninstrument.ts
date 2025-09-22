import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

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

  protected dryRun = Option.Boolean('-d,--dry-run', false)
  protected stepFunctionArns = Option.Array('-s,--step-function')

  // The options below are to match what InstrumentStepFunctionsCommand has so that customers can switch from instrument to uninstrument.
  // Lambda command adopts the same approach as well.
  protected environment = Option.String('-e,--env', {hidden: true})
  protected forwarderArn = Option.String('--forwarder', {hidden: true})
  protected service = Option.String('--service', {hidden: true})
  protected mergeStepFunctionAndLambdaTraces = Option.Boolean(
    '-mlt,--merge-lambda-traces,--merge-step-function-and-lambda-traces',
    false,
    {hidden: true}
  )

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
