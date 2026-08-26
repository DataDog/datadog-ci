import crypto from 'crypto'
import fs from 'fs'

import type {Sourcemap} from './interfaces'
import type {Writable} from 'stream'
import type {RawSourceMap} from 'webpack-sources'

import {parse} from '@babel/parser'
import {ReplaceSource, SourceMapSource} from 'webpack-sources'

const DEBUG_ID_REGEX = /"?ddDebugId"?:"([0-9a-fA-F-]{36})"/
const SOURCE_CODE_CONTEXT_MARKER = 'DD_SOURCE_CODE_CONTEXT'

// Keep this progressive scanner in sync with build-plugins PR #489:
// https://github.com/DataDog/build-plugins/pull/489
// Read progressively so the common case only needs the first KiB, while still supporting
// bundlers or transforms that place the injected snippet later in the artifact.
export const DEBUG_ID_SEARCH_CHUNK_BYTES = 1024
export const SOURCE_CODE_CONTEXT_SEARCH_CHUNK_BYTES = 64 * 1024

// Keep enough content from the previous chunk to match a debug ID literal split across a read
// boundary. The longest supported literal is shorter than this overlap.
const FILE_SEARCH_OVERLAP_CHARACTERS = 64
const VARIANT_CHARS = ['8', '9', 'a', 'b'] as const

const matchDebugId = (fileContent: string): string | undefined => DEBUG_ID_REGEX.exec(fileContent)?.[1]

// Search in fixed-size reads and stop as soon as a match is found. Only a small overlap is retained
// between reads, so even the worst case (scanning to EOF) uses bounded memory.
const searchFile = <T>(filePath: string, match: (fileContent: string) => T | undefined): T | undefined => {
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
        const result = match(searchableContent)
        if (result !== undefined) {
          return result
        }

        overlap = searchableContent.slice(-FILE_SEARCH_OVERLAP_CHARACTERS)
        position += bytesRead
      }
    } finally {
      fs.closeSync(fileDescriptor)
    }
  } catch {
    // Unreadable file: treated as having no match.
    return undefined
  }
}

export const extractDebugId = (filePath: string): string | undefined => searchFile(filePath, matchDebugId)

// Default service/version uploads may contain many large bundles. Scan them asynchronously in
// larger chunks so checking marker-free files does not block the event loop with thousands of
// small reads. Keep an overlap so markers split across chunk boundaries are still detected.
export const hasSourceCodeContext = async (filePath: string): Promise<boolean> => {
  try {
    const fileHandle = await fs.promises.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(SOURCE_CODE_CONTEXT_SEARCH_CHUNK_BYTES)
      let overlap = ''
      let position = 0

      while (true) {
        const {bytesRead} = await fileHandle.read(buffer, 0, SOURCE_CODE_CONTEXT_SEARCH_CHUNK_BYTES, position)
        if (bytesRead === 0) {
          return false
        }

        const searchableContent = overlap + buffer.toString('utf8', 0, bytesRead)
        if (searchableContent.includes(SOURCE_CODE_CONTEXT_MARKER)) {
          return true
        }

        overlap = searchableContent.slice(-FILE_SEARCH_OVERLAP_CHARACTERS)
        position += bytesRead
      }
    } finally {
      await fileHandle.close()
    }
  } catch {
    // Unreadable file: treated as not having the source code context marker.
    return false
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

const isEmptySourcemap = (sourcemap: ParsedSourcemap): boolean =>
  sourcemap.sections === undefined && sourcemap.mappings === ''

const assertSourcemapSupportsInjection = (sourcemap: ParsedSourcemap): void => {
  if (sourcemap.sections !== undefined) {
    throw new Error('Indexed sourcemaps with "sections" are not supported by sourcemaps inject')
  }
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
  `(function(c,n){try{if(typeof window==='undefined')return;var w=window,m=w[n]=w[n]||{},s=new Error().stack;s&&(m[s]=c)}catch(e){}})({"ddDebugId":"${debugId}"},"${SOURCE_CODE_CONTEXT_MARKER}");`

const HASHBANG_REGEX = /^#!.*(?:\r\n|\r|\n)/

interface DirectivePrologue {
  end: number
  needsSemicolon: boolean
}

const findDirectivePrologue = (source: string): DirectivePrologue => {
  const firstNonWhitespace = source.search(/\S/u)
  if (firstNonWhitespace === -1 || !`"'/`.includes(source[firstNonWhitespace])) {
    return {end: 0, needsSemicolon: false}
  }

  const {program} = parse(source, {
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    attachComment: false,
    plugins: ['jsx'],
    sourceType: 'unambiguous',
  })
  const directiveEnd = program.directives.at(-1)?.end
  if (!directiveEnd) {
    return {end: 0, needsSemicolon: false}
  }

  let insertionOffset = directiveEnd
  while (/\s/u.test(source[insertionOffset] ?? '')) {
    insertionOffset++
  }

  return {end: insertionOffset, needsSemicolon: source[directiveEnd - 1] !== ';'}
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

const PRE_INJECTION_SOURCE_NAME = 'dd-pre-injection.js'

// The snippet is inserted as early as possible, after an optional hashbang and the complete
// directive prologue. Obvious non-directive bundles take a fast path; possible directives are
// parsed so semicolonless directives and expression continuations follow JavaScript semantics.
// SourceMapSource starts with the original generated code and its map. ReplaceSource
// applies insertions directly to that mapped source, preserving existing mappings
// while shifting their generated positions.
const injectDebugIdSnippetIntoSourcemap = (
  jsContent: string,
  originalSourcemap: ParsedSourcemap,
  debugId: string
): {js: string; sourcemap: string} => {
  const hashbangMatch = jsContent.match(HASHBANG_REGEX)
  const hashbangPortion = hashbangMatch ? hashbangMatch[0] : ''
  const sourceWithoutHashbang = jsContent.slice(hashbangPortion.length)

  const directivePrologue = findDirectivePrologue(sourceWithoutHashbang)
  const injectionOffset = hashbangPortion.length + directivePrologue.end

  assertSourcemapSupportsInjection(originalSourcemap)
  const source = new SourceMapSource(jsContent, PRE_INJECTION_SOURCE_NAME, originalSourcemap)
  const injected = new ReplaceSource(source)
  injected.insert(injectionOffset, `${directivePrologue.needsSemicolon ? ';' : ''}${buildSnippet(debugId)}\n`)

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

export const injectDebugIdSnippet = (
  jsContent: string,
  sourcemapContent: string,
  debugId: string
): {js: string; sourcemap: string} =>
  injectDebugIdSnippetIntoSourcemap(jsContent, parseSourcemap(sourcemapContent), debugId)

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
    let sourcemap: ParsedSourcemap
    try {
      sourcemap = parseSourcemap(fs.readFileSync(payload.sourcemapPath, 'utf-8'))
      if (isEmptySourcemap(sourcemap)) {
        result.skipped++
        stdout.write(`Skipped ${payload.sourcemapPath}: sourcemap contains no mappings.\n`)
        continue
      }
      if (payload.debugId === undefined) {
        assertSourcemapSupportsInjection(sourcemap)
      }
    } catch (error) {
      result.failed++
      const action = payload.debugId === undefined ? 'inject' : 'record'
      stdout.write(`WARN: Failed to ${action} debug ID in ${payload.sourcemapPath}: ${error}\n`)
      continue
    }

    if (payload.debugId !== undefined) {
      try {
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
    try {
      jsContent = fs.readFileSync(payload.minifiedFilePath, 'utf-8')
    } catch (error) {
      result.failed++
      stdout.write(`WARN: Failed to read ${payload.minifiedFilePath} or its sourcemap: ${error}\n`)
      continue
    }

    const debugId = generateDebugId(jsContent)
    stdout.write(`Generated debug ID for ${payload.minifiedFilePath}: ${debugId}\n`)

    try {
      const {js, sourcemap: updatedSourcemap} = injectDebugIdSnippetIntoSourcemap(jsContent, sourcemap, debugId)
      if (dryRun) {
        payload.debugId = debugId
        result.injected++
        stdout.write('Dry run: no files modified.\n')
        continue
      }

      replaceArtifacts([
        {content: js, filePath: payload.minifiedFilePath},
        {content: updatedSourcemap, filePath: payload.sourcemapPath},
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
