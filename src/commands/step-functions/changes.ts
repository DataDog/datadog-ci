import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {
  CreateLogGroupRequest,
  DeleteSubscriptionFilterRequest,
  PutSubscriptionFilterRequest,
  TagStepFunctionRequest,
  UntagLogGroupRequest,
  UpdateStepFunctionRequest,
} from './interfaces'

export const displayChanges = (
  requestsByStepFunction: {
    [stepFunctionArn: string]: (
      | CreateLogGroupRequest
      | DeleteSubscriptionFilterRequest
      | PutSubscriptionFilterRequest
      | TagStepFunctionRequest
      | UntagLogGroupRequest
      | UpdateStepFunctionRequest
    )[]
  },
  dryRun: boolean,
  context: BaseContext
): void => {
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`${dryRun ? '[Dry Run] ' : ''}Will apply the following updates for ${stepFunctionArn}\n`)
    for (const request of requests) {
      if ('previousParams' in request) {
        context.stdout.write(
          `${request.operation} -> ${JSON.stringify(diff(request.params, request.previousParams), undefined, 2)}`
        )
        context.stdout.write(` --> ${JSON.stringify(diff(request.previousParams, request.params), undefined, 2)}\n`)
      } else {
        context.stdout.write(`${request.operation} -> ${JSON.stringify(request.params, undefined, 2)}\n`)
      }
    }
  }
}

export const applyChanges = async (
  requestsByStepFunction: {
    [stepFunctionArn: string]: (
      | CreateLogGroupRequest
      | DeleteSubscriptionFilterRequest
      | PutSubscriptionFilterRequest
      | TagStepFunctionRequest
      | UntagLogGroupRequest
      | UpdateStepFunctionRequest
    )[]
  },
  context: BaseContext
): Promise<void> => {
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`Updating resources for ${stepFunctionArn}\n`)
    for (const request of requests) {
      context.stdout.write(`Calling ${request.operation}\n`)
      try {
        await request.function.promise()
        context.stdout.write(`${request.operation} succeeded\n`)
      } catch (err) {
        if (err instanceof Error) {
          if (err.name === 'ResourceAlreadyExistsException' && 'logGroupName' in request.params) {
            context.stdout.write(`[Warning] The log group ${request.params.logGroupName} already exists\n`)
          } else {
            throw err
          }
        } else {
          throw new Error(`[Error] ${String(err)}\n`)
        }
      }
    }
  }
}
