import {CloudWatchLogs, Lambda} from 'aws-sdk'
import { blueBright, green, yellow } from 'chalk'

export const uninstrumentLambdaFunctions = async (
  lambda: Lambda,
  cloudWatch: CloudWatchLogs,
  configurations: Lambda.FunctionConfiguration[]
) => {
  const results = configurations.map(async (c) => {
    try {
      const functionARN = c.FunctionArn!
      const tags = await lambda.listTags({Resource: functionARN}).promise()
      console.log(`Tags -> ${green(JSON.stringify(tags, undefined, 2))}\n`)
      console.log(`Environment variables -> ${yellow(JSON.stringify(c.Environment, undefined, 2))}\n`)
      console.log(`Layers -> ${blueBright(JSON.stringify(c.Layers, undefined, 2))}\n`)
    } catch (err) {
      throw new Error(`An error occurred while trying to un-instrumenta function ${err}`)
    }
    // TODO: Apply uninstrumentation
  })

  await Promise.all(results)
}
