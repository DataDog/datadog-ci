import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {AWSRequestMetadata, RequestsByStepFunction} from './interfaces'

export const displayChanges = (
  requestsByStepFunction: RequestsByStepFunction,
  dryRun: boolean,
  context: BaseContext
): void => {
  context.stdout.write(`\n${dryRun ? '[Dry Run] ' : ''}Will apply the following changes:\n`)
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
    for (const request of requests) {
      const func = request.function.valueOf() as AWSRequestMetadata
      if (request.previousParams !== undefined) {
        context.stdout.write(
          `${func.operation} ->\n${JSON.stringify(
            diff(func.params, request.previousParams),
            undefined,
            2
          )}\n--->\n${JSON.stringify(diff(request.previousParams, func.params), undefined, 2)}\n`
        )
      } else {
        context.stdout.write(`${func.operation} ->\n${JSON.stringify(func.params, undefined, 2)}\n`)
      }
    }
  }
}

export const applyChanges = async (
  requestsByStepFunction: RequestsByStepFunction,
  context: BaseContext
): Promise<boolean> => {
  let error = false
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`\nApplying changes for ${stepFunctionArn}\n`)
    for (const request of requests) {
      const func = request.function.valueOf() as AWSRequestMetadata
      context.stdout.write(`${func.operation}`)
      try {
        await request.function.promise()
        context.stdout.write(' -> success')
      } catch (err) {
        if (err instanceof Error) {
          // if a resource already exists it's a warning since we can use that resource instead of creating it
          if (err.name === 'ResourceAlreadyExistsException') {
            context.stdout.write(
              ` -> [Info] ${err.message}. Skipping resource creation and continuing with instrumentation`
            )
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
