import crypto from 'crypto'
import fs from 'fs'

import type {Sourcemap} from './interfaces'
import type {Writable} from 'stream'
import type {RawSourceMap} from 'webpack-sources'

import {ReplaceSource, SourceMapSource} from 'webpack-sources'

const DEBUG_ID_REGEX = /"?ddDebugId"?:"([0-9a-fA-F-]{36})"/

// Keep this progressive scanner in sync with build-plugins PR #489:
// https://github.com/DataDog/build-plugins/pull/489
// Read progressively so the common case only needs the first KiB, while still supporting
// bundlers or transforms that place the injected snippet later in the artifact.
export const DEBUG_ID_SEARCH_CHUNK_BYTES = 1024

// Keep enough content from the previous chunk to match a debug ID literal split across a read
// boundary. The longest supported literal is shorter than this overlap.
const DEBUG_ID_SEARCH_OVERLAP_CHARACTERS = 64
const VARIANT_CHARS = ['8', '9', 'a', 'b'] as const

const matchDebugId = (fileContent: string): string | undefined => DEBUG_ID_REGEX.exec(fileContent)?.[1]

// Search in fixed-size reads and stop as soon as the debug ID is found. Only a small overlap is
// retained between reads, so even the worst case (scanning to EOF) uses bounded memory.
export const extractDebugId = (filePath: string): string | undefined => {
  try {
    const fileDescriptor = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(DEBUG_ID_SEARCH_CHUNK_BYTES)
      let overlap = ''
      let position = 0

      while (true) {
        const bytesRead = fs.readSync(fileDescriptor, buffer, 0, DEBUG_ID_SEARCH_CHUNK_BYTES, position)
        if (bytesRead === 0) {
          return undefined
        }

        const searchableContent = overlap + buffer.toString('utf-8', 0, bytesRead)
        const debugId = matchDebugId(searchableContent)
        if (debugId) {
          return debugId
        }

        overlap = searchableContent.slice(-DEBUG_ID_SEARCH_OVERLAP_CHARACTERS)
        position += bytesRead
      }
    } finally {
      fs.closeSync(fileDescriptor)
    }
  } catch {
    // Unreadable file: treated as having no debug ID.
    return undefined
  }
}

type ParsedSourcemap = RawSourceMap & Record<string, unknown>

const parseSourcemap = (sourcemapContent: string): ParsedSourcemap => {
  const parsed = JSON.parse(sourcemapContent) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sourcemap must be a JSON object')
  }

  return parsed as ParsedSourcemap
}

/** Adds extracted IDs to payloads and reports whether at least one was found. */
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

// Keep this runtime snippet in sync with build-plugins:
// https://github.com/DataDog/build-plugins/blob/c9384d115d53578f220cd5e1f29994acb96a1782/packages/plugins/rum/src/getSourceCodeContextSnippet.ts#L55
const buildSnippet = (debugId: string): string =>
  `(function(c,n){try{if(typeof window==='undefined')return;var w=window,m=w[n]=w[n]||{},s=new Error().stack;s&&(m[s]=c)}catch(e){}})({"ddDebugId":"${debugId}"},"DD_SOURCE_CODE_CONTEXT");`

const HASHBANG_REGEX = /^#!.*(?:\r\n|\r|\n)/
const USE_DIRECTIVE_REGEX =
  /^(?:\s|\/\*[\s\S]*?\*\/|\/\/.*(?:\r\n|\r|\n))*(?<useDirective>"use [^"]*"|'use [^']*');?(?:\r\n|\r|\n)?/

// A directive prologue can hold more than one directive (e.g. `"use strict"; "use asm";`), and
// every one of them must be repeated ahead of the injected snippet: once the injected statement
// is inserted, it ends the prologue, so any directive left behind after it is a no-op instead of
// an active directive. Matches greedily from the front, one directive at a time, to capture the
// full leading run rather than just the first.
const extractLeadingUseDirectives = (source: string): string => {
  let offset = 0
  let directives = ''
  for (;;) {
    const match = source.slice(offset).match(USE_DIRECTIVE_REGEX)
    if (!match?.groups?.useDirective) {
      break
    }
    directives += `${match.groups.useDirective};`
    offset += match[0].length
  }

  return directives
}

// Keep this deterministic SHA-256 strategy in sync with build-plugins:
// https://github.com/DataDog/build-plugins/blob/3eb123ebd22be37d5ef624f0ffa455bf13309874/packages/plugins/rum/src/debugId.ts#L11
export const generateDebugId = (jsContent: string): string => {
  const hash = crypto.createHash('sha256').update(jsContent).digest('hex').slice(0, 32)
  const withVersion = `${hash.slice(0, 12)}4${hash.slice(13)}`
  const variantIndex = withVersion.charCodeAt(16) % 4
  const withVariant = `${withVersion.slice(0, 16)}${VARIANT_CHARS[variantIndex]}${withVersion.slice(17)}`

  return [
    withVariant.slice(0, 8),
    withVariant.slice(8, 12),
    withVariant.slice(12, 16),
    withVariant.slice(16, 20),
    withVariant.slice(20, 32),
  ].join('-')
}

const PRE_INJECTION_SOURCE_NAME = 'pre-injection.js'

// The snippet is inserted as early as possible (after an optional hashbang and/or
// leading "use ...;" directives, which are kept first since they must remain the first
// statements in the file).
// SourceMapSource starts with the original generated code and its map. ReplaceSource
// applies insertions directly to that mapped source, preserving existing mappings
// while shifting their generated positions.
export const injectDebugIdSnippet = (
  jsContent: string,
  sourcemapContent: string,
  debugId: string
): {js: string; sourcemap: string} => {
  const hashbangMatch = jsContent.match(HASHBANG_REGEX)
  const hashbangPortion = hashbangMatch ? hashbangMatch[0] : ''
  const sourceWithoutHashbang = jsContent.slice(hashbangPortion.length)

  const useDirectives = extractLeadingUseDirectives(sourceWithoutHashbang)

  const originalSourcemap = parseSourcemap(sourcemapContent)
  if (originalSourcemap.sections !== undefined) {
    throw new Error('Indexed sourcemaps with "sections" are not supported by sourcemaps inject')
  }
  const source = new SourceMapSource(jsContent, PRE_INJECTION_SOURCE_NAME, originalSourcemap)
  const injected = new ReplaceSource(source)
  injected.insert(hashbangPortion.length, `${useDirectives}${buildSnippet(debugId)}\n`)

  const {source: injectedSource, map} = injected.sourceAndMap({columns: true})
  if (!map) {
    throw new Error('Failed to generate the adjusted sourcemap')
  }

  // The inject command keeps the sourcemap metadata aligned with the runtime snippet.
  // Upload matching remains based on ddDebugId in the JavaScript so build-plugin maps
  // without this field continue to work.
  const combinedMap: Record<string, unknown> = {...originalSourcemap, ...map, debug_id: debugId}
  // webpack-sources resolves sourceRoot into each source path. Keeping sourceRoot
  // would apply it a second time. Its generated `file: "x"` placeholder is also
  // replaced with the original value (or omitted when the input had none).
  delete combinedMap.sourceRoot
  if (originalSourcemap.file === undefined) {
    delete combinedMap.file
  } else {
    combinedMap.file = originalSourcemap.file
  }

  return {
    js: injectedSource.toString(),
    sourcemap: JSON.stringify(combinedMap),
  }
}

export interface InjectionResult {
  failed: number
  injected: number
  skipped: number
}

const removeTemporaryFile = (filePath: string): void => {
  try {
    fs.rmSync(filePath, {force: true})
  } catch {
    // Best-effort cleanup. A failure here must not hide the injection or rollback result.
  }
}

/**
 * Replaces one or more artifacts as one rollback-safe operation. Every new file is
 * fully staged beside its destination before the originals are moved. If any staged
 * file cannot be promoted, every original that was moved is restored.
 */
const replaceArtifacts = (artifacts: {content: string; filePath: string}[]): void => {
  const transactionId = `${process.pid}-${crypto.randomUUID()}`
  const replacements = artifacts.map(({content, filePath}) => ({
    backupPath: `${filePath}.${transactionId}.backup`,
    content,
    filePath,
    stagedPath: `${filePath}.${transactionId}.tmp`,
  }))

  let backedUpCount = 0
  try {
    for (const replacement of replacements) {
      const mode = fs.statSync(replacement.filePath).mode
      fs.writeFileSync(replacement.stagedPath, replacement.content, {mode})
    }

    for (const replacement of replacements) {
      fs.renameSync(replacement.filePath, replacement.backupPath)
      backedUpCount++
      fs.renameSync(replacement.stagedPath, replacement.filePath)
    }
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const replacement of replacements.slice(0, backedUpCount).reverse()) {
      try {
        fs.rmSync(replacement.filePath, {force: true})
        fs.renameSync(replacement.backupPath, replacement.filePath)
      } catch (rollbackError) {
        rollbackErrors.push(`${replacement.filePath}: ${rollbackError}`)
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(`${error}; rollback also failed for ${rollbackErrors.join(', ')}`)
    }
    throw error
  } finally {
    for (const replacement of replacements) {
      removeTemporaryFile(replacement.stagedPath)
    }
  }

  for (const replacement of replacements) {
    removeTemporaryFile(replacement.backupPath)
  }
}

/**
 * For every payload with no extracted debug ID, generates one from the original
 * minified file, injects its runtime snippet, and adjusts the sourcemap mappings
 * (unless `dryRun`). A payload failure does not abort the rest of the batch.
 */
export const injectMissingDebugIds = (payloads: Sourcemap[], dryRun: boolean, stdout: Writable): InjectionResult => {
  const result: InjectionResult = {failed: 0, injected: 0, skipped: 0}

  for (const payload of payloads) {
    if (payload.debugId !== undefined) {
      try {
        const existingSourcemapContent = fs.readFileSync(payload.sourcemapPath, 'utf-8')
        const sourcemap = parseSourcemap(existingSourcemapContent)
        if (sourcemap.debug_id === payload.debugId) {
          result.skipped++
          continue
        }

        const updatedSourcemap = JSON.stringify({...sourcemap, debug_id: payload.debugId})
        stdout.write(`Recorded existing debug ID in ${payload.sourcemapPath}: ${payload.debugId}\n`)
        if (dryRun) {
          result.injected++
          stdout.write('Dry run: no files modified.\n')
          continue
        }

        replaceArtifacts([{content: updatedSourcemap, filePath: payload.sourcemapPath}])
        result.injected++
      } catch (error) {
        result.failed++
        stdout.write(`WARN: Failed to record debug ID in ${payload.sourcemapPath}: ${error}\n`)
      }
      continue
    }

    let jsContent: string
    let sourcemapContent: string
    try {
      jsContent = fs.readFileSync(payload.minifiedFilePath, 'utf-8')
      sourcemapContent = fs.readFileSync(payload.sourcemapPath, 'utf-8')
    } catch (error) {
      result.failed++
      stdout.write(`WARN: Failed to read ${payload.minifiedFilePath} or its sourcemap: ${error}\n`)
      continue
    }

    const debugId = generateDebugId(jsContent)
    stdout.write(`Generated debug ID for ${payload.minifiedFilePath}: ${debugId}\n`)

    try {
      const {js, sourcemap} = injectDebugIdSnippet(jsContent, sourcemapContent, debugId)
      if (dryRun) {
        payload.debugId = debugId
        result.injected++
        stdout.write('Dry run: no files modified.\n')
        continue
      }

      replaceArtifacts([
        {content: js, filePath: payload.minifiedFilePath},
        {content: sourcemap, filePath: payload.sourcemapPath},
      ])
      payload.debugId = debugId
      result.injected++
    } catch (error) {
      result.failed++
      stdout.write(`WARN: Failed to inject debug ID into ${payload.minifiedFilePath}: ${error}\n`)
    }
  }

  return result
}
