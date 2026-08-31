import fs from 'fs'

import {isValidDebugId, DEBUG_ID_VALUE_PATTERN} from './debugId'

export const SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES = 64 * 1024

export interface SourcemapDebugIdResult {
  debugId?: string
  error?: string
}

// Match the top-level sourcemap `debug_id` field. Real sourcemap keys are serialized with
// unescaped quotes; the same literal nested inside a `sourcesContent` string value is escaped
// as `\"debug_id\":\"...\"`, so requiring unescaped quotes skips that common nested case without
// a full JSON parser. A non-standard nested object field named `debug_id` would still match.
const DEBUG_ID_FIELD_REGEX = new RegExp(`"debug_id"\\s*:\\s*"(${DEBUG_ID_VALUE_PATTERN})"`, 'i')

// Keep enough content from the previous chunk to match a debug_id literal split across a read
// boundary. The longest supported literal is shorter than this overlap.
const SEARCH_OVERLAP_CHARACTERS = 128

// Search in fixed-size reads and stop as soon as the debug ID is found. Only a small overlap is
// retained between reads, so even the worst case (scanning to EOF) uses bounded memory.
export const extractSourcemapDebugId = async (sourcemapPath: string): Promise<SourcemapDebugIdResult> => {
  try {
    const fileHandle = await fs.promises.open(sourcemapPath, 'r')
    try {
      const buffer = Buffer.alloc(SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES)
      let overlap = ''
      let position = 0

      while (true) {
        const {bytesRead} = await fileHandle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) {
          return {}
        }

        const searchableContent = overlap + buffer.toString('utf8', 0, bytesRead)
        const match = DEBUG_ID_FIELD_REGEX.exec(searchableContent)
        if (match && isValidDebugId(match[1])) {
          return {debugId: match[1]}
        }

        overlap = searchableContent.slice(-SEARCH_OVERLAP_CHARACTERS)
        position += bytesRead
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    return {error: (error as Error).message}
  }
}
