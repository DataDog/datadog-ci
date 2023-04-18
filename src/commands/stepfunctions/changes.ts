import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {RequestsByStepFunction} from './interfaces'
import {TagResourceCommand} from "@aws-sdk/client-sfn";


export const displayChanges2 = (
  stepFunctionArn: string,
  context: BaseContext,
  commandName: string,
  dryRun: boolean,
  params?: any,
  previousParams?: any
): void => {
  context.stdout.write(`\n${dryRun ? '[Dry Run] ' : ''}Will apply the following changes:\n`)
  context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
  if (previousParams !== undefined) {
    context.stdout.write(
      `${commandName} ->\n${JSON.stringify(
        diff(params, previousParams),
        undefined,
        2
      )}\n--->\n${JSON.stringify(diff(previousParams, params), undefined, 2)}\n`
    )
  } else {
    context.stdout.write(`${commandName} ->\n${JSON.stringify(params, undefined, 2)}\n`)
  }
}
export const displayChanges = (
  requestsByStepFunction: RequestsByStepFunction,
  dryRun: boolean,
  context: BaseContext
): void => {
  context.stdout.write(`\n${dryRun ? '[Dry Run] ' : ''}Will apply the following changes:\n`)
  for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
    context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
    for (const request of requests) {
      if (request.previousParams !== undefined) {
        context.stdout.write(
          `${typeof request.command} ->\n${JSON.stringify(
            diff(request.params, request.previousParams),
            undefined,
            2
          )}\n--->\n${JSON.stringify(diff(request.previousParams, request.params), undefined, 2)}\n`
        )
      } else {
        context.stdout.write(`${typeof request.command} ->\n${JSON.stringify(request.params, undefined, 2)}\n`)
      }
    }
  }
}

// export const applyChanges = async (
//   requestsByStepFunction: RequestsByStepFunction,
//   context: BaseContext
// ): Promise<boolean> => {
//   let error = false
//   for (const [stepFunctionArn, requests] of Object.entries(requestsByStepFunction)) {
//     context.stdout.write(`\nApplying changes for ${stepFunctionArn}\n`)
//     for (const request of requests) {
//       context.stdout.write(`${typeof request.command}`)
//       try {
//         // const params = {
//         //   resourceArn: stepFunctionArn,
//         //   tags,
//         // }
//         // await request.client.send(new request.command(request.params))
//         await request.client.send(request.command)
//         context.stdout.write(' -> success')
//       } catch (err) {
//         if (err instanceof Error) {
//           // if a resource already exists it's a warning since we can use that resource instead of creating it
//           if (err.name === 'ResourceAlreadyExistsException') {
//             context.stdout.write(
//               ` -> [Info] ${err.message}. Skipping resource creation and continuing with instrumentation`
//             )
//             // otherwise it's an error we don't expect that could affect later requests
//           } else {
//             error = true
//             context.stdout.write(` -> [Error] ${err.message}`)
//           }
//         } else {
//           error = true
//           context.stdout.write(` -> [Error] ${err}`)
//         }
//       }
//       context.stdout.write('\n')
//     }
//   }
//
//   return error
// }
