import fs from 'fs'

import type {Sourcemap} from './interfaces'

const DD_DEBUG_ID_REGEX =
  /["']ddDebugId["']\s*:\s*["']([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})["']/

export const extractDebugId = (filePath: string): string | undefined => {
  try {
    const source = fs.readFileSync(filePath, 'utf-8')

    return source.match(DD_DEBUG_ID_REGEX)?.[1]
  } catch {
    // Unreadable file: treated as having no debug ID.
    return undefined
  }
}

/**
 * Adds the debug ID extracted from each payload's minified file onto the
 * payload. Returns true if at least one payload has a debug ID.
 */
export const addDebugIdToPayloads = (payloads: Sourcemap[]): boolean => {
  let hasAnyDebugId = false
  for (const payload of payloads) {
    payload.debugId = extractDebugId(payload.minifiedFilePath)
    if (payload.debugId !== undefined) {
      hasAnyDebugId = true
    }
  }

  return hasAnyDebugId
}
