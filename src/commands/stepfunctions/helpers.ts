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
      const lambdaUpdated = injectContextForLambdaFunctions(step, context, stepName);
      const stepUpdated = injectContextForStepFunctions(step);
      definitionHasBeenUpdated = lambdaUpdated || stepUpdated;
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

export const addTraceContextToLambdaParameters = ({Parameters}: StepType): void => {
  if (Parameters) {
    Parameters[`Payload.$`] = 'States.JsonMerge($$, $, false)'
  }
}

export const addTraceContextToStepFunctionParameters = ({Parameters}: StepType): void => {
  if (Parameters) {
    if (!Parameters.Input) {
      Parameters.Input = {}
    }
    Parameters.Input['CONTEXT.$'] = 'States.JsonMerge($$, $, false)'
  }
}

export const shouldUpdateStepForTracesMerging = (step: StepType): boolean => {
  // is default lambda api
  if (step.Resource === 'arn:aws:states:::lambda:invoke') {
    if (!step.Parameters) {
      return false
    }
    // payload field not set
    if (!step.Parameters.hasOwnProperty('Payload.$')) {
      return true
    }
    // default payload
    if (step.Parameters['Payload.$'] === '$') {
      return true
    }
  }

  return false
}

// Truth table
// Input                    | Expected
// -------------------------|---------
// Empty object             | true
// undefined                | true
// not object               | false
// object without CONTEXT.$ | true
// object with CONTEXT.$    | false
export const shouldUpdateStepForStepFunctionContextInjection = (step: StepType): boolean => {
  // is default lambda api
  if (step.Resource?.startsWith('arn:aws:states:::states:startExecution')) {
    if (!step.Parameters) {
      return false
    }
    if (!step.Parameters.Input) {
      return true
    }
    if (typeof step.Parameters.Input !== 'object') {
      return false
    }
    if (!step.Parameters.Input['CONTEXT.$']) {
      return true
    }
  }

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
  FunctionName?: string
  StateMachineArn?: string
  TableName?: string
  Input?: {
    'CONTEXT.$'?: string
  }
}

const injectContextForLambdaFunctions = (step: StepType, context: BaseContext, stepName: string): boolean => {
  if (shouldUpdateStepForTracesMerging(step)) {
    addTraceContextToLambdaParameters(step)

    return true
  } else if (step.Resource?.startsWith('arn:aws:lambda')) {
    context.stdout.write(
      `[Warn] Step ${stepName} may be using the basic legacy integration, which does not support merging lambda trace(s) with Step Functions trace.
          To merge lambda trace(s) with Step Functions trace, please consider using the latest integration.
          More details can be found on https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html \n`
    )
  }

  return false
}

export const injectContextForStepFunctions = (step: StepType): boolean => {
  if (shouldUpdateStepForStepFunctionContextInjection(step)) {
    addTraceContextToStepFunctionParameters(step)

    return true
  }

  return false
}
