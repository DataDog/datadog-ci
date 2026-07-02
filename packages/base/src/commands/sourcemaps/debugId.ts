import fs from 'fs'

import type {CommandContext} from '@datadog/datadog-ci-base'

const DD_DEBUG_ID_REGEX = /["']ddDebugId["']\s*:\s*["']([^"']+)["']/

export const extractDebugId = (filePath: string, context: CommandContext): string | undefined => {
  try {
    const source = fs.readFileSync(filePath, 'utf-8')
    const match = source.match(DD_DEBUG_ID_REGEX)
    if (match) {
      return match[1]
    }
    context.stderr.write(`Debug ID not found in ${filePath}\n`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    context.stderr.write(`Cannot extract Debug ID from ${filePath}: ${errorMsg}\n`)
  }

  return undefined
}
