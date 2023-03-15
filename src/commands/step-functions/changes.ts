import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {
  CreateLogGroupRequest,
  DeleteSubscriptionFilterRequest,
  PutSubscriptionFilterRequest,
  TagStepFunctionRequest,
  UntagStepFunctionRequest,
  UpdateStepFunctionRequest,
} from './interfaces'

export const displayChanges = (
  requestsByStepFunction: {
    [stepFunctionArn: string]: (
      | CreateLogGroupRequest
      | DeleteSubscriptionFilterRequest
      | PutSubscriptionFilterRequest
      | TagStepFunctionRequest
      | UntagStepFunctionRequest
      | UpdateStepFunctionRequest
    )[]
  },
  dryRun: boolean,
  context: BaseContext
): void => {
  context.stdout.write(`\n${dryRun ? '[Dry Run] ' : ''}Will apply the following changes:\n`)
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
    for (const request of requests) {
      if ('previousParams' in request) {
        context.stdout.write(
          `${request.operation} ->\n${JSON.stringify(
            diff(request.params, request.previousParams),
            undefined,
            2
          )}\n--->\n${JSON.stringify(diff(request.previousParams, request.params), undefined, 2)}\n`
        )
      } else {
        context.stdout.write(`${request.operation} ->\n${JSON.stringify(request.params, undefined, 2)}\n`)
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
      | UntagStepFunctionRequest
      | UpdateStepFunctionRequest
    )[]
  },
  context: BaseContext
): Promise<boolean> => {
  let error = false
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`\nApplying changes for ${stepFunctionArn}\n`)
    for (const request of requests) {
      context.stdout.write(`${request.operation}`)
      try {
        await request.function.promise()
        context.stdout.write(' -> success')
      } catch (err) {
        if (err instanceof Error) {
          // if a resource already exists it's a warning since we can use that resource instead of creating it
          if (err.name === 'ResourceAlreadyExistsException') {
            context.stdout.write(` -> [Warning] ${err.message}`)
            // otherwise it's an error we don't expect that could affect later requests
          } else {
            error = true
            context.stdout.write(` -> [Error] ${err.message}`)
          }
        } else {
          error = true
          context.stdout.write(` -> [Error] ${err}`)
        }
      }
      context.stdout.write('\n')
    }
  }

  return error
}
