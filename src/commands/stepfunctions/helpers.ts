import {DescribeStateMachineCommandOutput} from '@aws-sdk/client-sfn'
import {SFNClient} from '@aws-sdk/client-sfn/dist-types/SFNClient'
import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {updateStateMachineDefinition} from './awsCommands'
import {DD_CI_IDENTIFYING_STRING} from './constants'

export const displayChanges = (
  stepFunctionArn: string,
  context: BaseContext,
  commandName: string,
  dryRun: boolean,
  params: any,
  previousParams?: any
): void => {
  context.stdout.write(`\n${dryRun ? '\nPlanning for' : 'Will apply'} the following change:\n`)
  if (previousParams !== undefined) {
    context.stdout.write(
      `\n${commandName}:\nFrom:\n${JSON.stringify(diff(params, previousParams), undefined, 2)}\nTo:\n${JSON.stringify(
        diff(previousParams, params),
        undefined,
        2
      )}\n`
    )
  } else {
    context.stdout.write(`\n${commandName}:\n${JSON.stringify(params, undefined, 2)}\n`)
  }
}

export const buildArn = (
  partition: string,
  service: string,
  region: string,
  accountId: string,
  resourceType: string,
  resourceId: string
): string => {
  return `arn:${partition}:${service}:${region}:${accountId}:${resourceType}:${resourceId}`
}

export const buildLogGroupName = (stepFunctionName: string, env: string | undefined): string => {
  return `/aws/vendedlogs/states/${stepFunctionName}-Logs${env !== undefined ? '-' + env : ''}`
}

export const buildSubscriptionFilterName = (stepFunctionName: string): string => {
  return `${stepFunctionName}-${DD_CI_IDENTIFYING_STRING}`
}

export const isValidArn = (str: string): boolean => {
  const arnFields = str.split(':')

  return arnFields.length >= 7 && arnFields[0] === 'arn'
}

export const getStepFunctionLogGroupArn = (stepFunction: DescribeStateMachineCommandOutput): string | undefined => {
  const [logDestinations] = stepFunction.loggingConfiguration?.destinations ?? [{cloudWatchLogsLogGroup: {}}]

  return logDestinations.cloudWatchLogsLogGroup?.logGroupArn
}

export const parseArn = (
  arn: string
): {
  partition: string
  region: string
  accountId: string
  resourceName: string
} => {
  const [, partition, , region, accountId, , resourceName] = arn.split(':')

  return {
    partition,
    region,
    accountId,
    resourceName,
  }
}
export const buildLogAccessPolicyName = (stepFunction: DescribeStateMachineCommandOutput): string => {
  return `LogsDeliveryAccessPolicy-${stepFunction.name}`
}

export const injectContextIntoTasks = async (
  describeStateMachineCommandOutput: DescribeStateMachineCommandOutput,
  stepFunctionsClient: SFNClient,
  context: BaseContext,
  dryRun: boolean
): Promise<void> => {
  if (typeof describeStateMachineCommandOutput.definition !== 'string') {
    return
  }
  let definitionHasBeenUpdated = false
  const definitionObj = JSON.parse(describeStateMachineCommandOutput.definition) as StateMachineDefinitionType
  for (const stepName in definitionObj.States) {
    if (definitionObj.States.hasOwnProperty(stepName)) {
      const step = definitionObj.States[stepName]
      const lambdaUpdated = injectContextForLambdaFunctions(step, context, stepName)
      const stepUpdated = injectContextForStepFunctions(step, context, stepName)
      definitionHasBeenUpdated = lambdaUpdated || stepUpdated
    }
  }
  if (definitionHasBeenUpdated) {
    await updateStateMachineDefinition(
      stepFunctionsClient,
      describeStateMachineCommandOutput,
      definitionObj,
      context,
      dryRun
    )
  }
}

export const addTraceContextToLambdaParameters = (Parameters: ParametersType): void => {
  Parameters[`Payload.$`] = 'States.JsonMerge($$, $, false)'
}

export const addTraceContextToStepFunctionParameters = ({Parameters}: StepType): void => {
  if (Parameters) {
    if (!Parameters.Input) {
      Parameters.Input = {}
    }
    Parameters.Input['CONTEXT.$'] = 'States.JsonMerge($$, $, false)'
  }
}

// Truth table
// Input                    | Expected
// -------------------------|---------
// Empty object             | true
// undefined                | true
// not object               | false
// object without CONTEXT.$ | true
// object with CONTEXT.$    | false
export const shouldUpdateStepForStepFunctionContextInjection = (
  step: StepType,
  context: BaseContext,
  stepName: string
): boolean => {
  // not default lambda api
  if (!step.Resource?.startsWith('arn:aws:states:::states:startExecution')) {
    return false
  }

  if (!step.Parameters) {
    context.stdout
      .write(`[Warn] Step ${stepName} does not have a Parameters field. Step Functions Context Object injection \
skipped. Your Step Functions trace will not be merged with downstream Step Function traces. To manually merge these \
traces, check out https://docs.datadoghq.com/serverless/step_functions/troubleshooting/\n`)

    return false
  }

  if (!step.Parameters.Input) {
    return true
  }

  if (typeof step.Parameters.Input !== 'object') {
    context.stdout
      .write(`[Warn] Step ${stepName}'s Parameters.Input field is not a JSON object. Step Functions Context Object \
injection skipped. Your Step Functions trace will not be merged with downstream Step Function traces. To manually \
merge these traces, check out https://docs.datadoghq.com/serverless/step_functions/troubleshooting/\n`)

    return false
  }

  if (!step.Parameters.Input['CONTEXT.$'] && !step.Parameters.Input['CONTEXT']) {
    return true
  }

  // context injection is already set up
  if (step.Parameters.Input['CONTEXT.$'] === 'States.JsonMerge($$, $, false)') {
    context.stdout.write(` Step ${stepName}: Context injection is already set up. Skipping context injection.\n`)

    return false
  }

  context.stdout
    .write(`[Warn] Step ${stepName}'s Parameters.Input field has a custom CONTEXT field. Step Functions Context \
Object injection skipped. Your Step Functions trace will not be merged with downstream Step Function traces. To \
manually merge these traces, check out https://docs.datadoghq.com/serverless/step_functions/troubleshooting/\n`)

  return false
}

export type StateMachineDefinitionType = {
  Comment?: string
  StartAt?: string
  States?: StatesType
}

export type StatesType = Record<string, StepType>
export type StepType = {
  Type: string
  Parameters?: ParametersType
  Resource?: string
  Next?: string
  End?: boolean
}

export type ParametersType = {
  'Payload.$'?: string
  Payload?: string
  FunctionName?: string
  StateMachineArn?: string
  TableName?: string
  Input?: {
    'CONTEXT.$'?: string
    CONTEXT?: string
  }
}

export const injectContextForLambdaFunctions = (step: StepType, context: BaseContext, stepName: string): boolean => {
  if (step.Resource?.startsWith('arn:aws:lambda')) {
    context.stdout.write(
      `[Warn] Step ${stepName} may be using the basic legacy integration, which does not support merging lambda trace(s) with Step Functions trace.
          To merge lambda trace(s) with Step Functions trace, please consider using the latest integration.
          More details can be found on https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html \n`
    )

    return false
  }

  // not default lambda api
  if (step.Resource !== 'arn:aws:states:::lambda:invoke') {
    return false
  }

  if (!step.Parameters) {
    context.stdout
      .write(`[Warn] Step ${stepName} does not have a Parameters field. Step Functions Context Object injection \
skipped. Your Step Functions trace will not be merged with downstream Lambda traces. To manually merge these traces, \
check out https://docs.datadoghq.com/serverless/step_functions/troubleshooting/\n`)

    return false
  }

  // payload field not set
  if (!step.Parameters.hasOwnProperty('Payload.$') && !step.Parameters.hasOwnProperty('Payload')) {
    addTraceContextToLambdaParameters(step.Parameters)

    return true
  }

  // default payload
  if (step.Parameters['Payload.$'] === '$') {
    addTraceContextToLambdaParameters(step.Parameters)

    return true
  }

  // context injection is already set up
  if (step.Parameters['Payload.$'] === 'States.JsonMerge($$, $, false)') {
    context.stdout.write(` Step ${stepName}: Context injection is already set up. Skipping context injection.\n`)

    return false
  }

  // custom payload
  context.stdout
    .write(`[Warn] Step ${stepName} has a custom Payload field. Step Functions Context Object injection skipped. \
Your Step Functions trace will not be merged with downstream Lambda traces. To manually merge these traces, \
check out https://docs.datadoghq.com/serverless/step_functions/troubleshooting/\n`)

  return false
}

export const injectContextForStepFunctions = (step: StepType, context: BaseContext, stepName: string): boolean => {
  if (shouldUpdateStepForStepFunctionContextInjection(step, context, stepName)) {
    addTraceContextToStepFunctionParameters(step)

    return true
  }

  return false
}
