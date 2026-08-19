import crypto from 'crypto'
import fs from 'fs'

import type {Sourcemap} from './interfaces'
import type {Writable} from 'stream'
import type {RawSourceMap} from 'webpack-sources'

import {ReplaceSource, SourceMapSource} from 'webpack-sources'

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

/** Adds the extracted debug ID to each payload whose minified file contains one. */
export const addDebugIdToPayloads = (payloads: Sourcemap[]): void => {
  for (const payload of payloads) {
    payload.debugId = extractDebugId(payload.minifiedFilePath)
  }
}

// The runtime snippet read by the browser RUM SDK (packages/browser-core/src/domain/sourceCodeContext.ts),
// matching the shape build-plugins already injects via getSourceCodeContextSnippet.ts.
const buildSnippet = (debugId: string): string =>
  `(function(c,n){try{if(typeof window==='undefined')return;var w=window,m=w[n]=w[n]||{},s=new Error().stack;s&&(m[s]=c)}catch(e){}})({"ddDebugId":"${debugId}"},"DD_SOURCE_CODE_CONTEXT");`

const DEBUG_ID_COMMENT_PREFIX = '//# debugId'

const HASHBANG_REGEX = /^#!.*(?:\r\n|\r|\n)/
const SOURCE_MAPPING_URL_REGEX = /\/\/[#@] sourceMappingURL=.*(?:\r\n|\r|\n)?$/
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

// SHA-1 over "js" + 8-byte little-endian length + JS bytes + "sourcemap" + 8-byte
// little-endian length + sourcemap bytes, truncated to 16 bytes, formatted as a UUID
// with the version nibble forced to 5 and variant bits forced to RFC4122. NOT the
// v4-style forcing used by RN's own generateDebugId, which is an unrelated convention
// specific to RN's MD5 scheme.
export const generateDebugId = (jsContent: string, sourcemapContent: string): string => {
  const jsBytes = Buffer.from(jsContent, 'utf-8')
  const sourcemapBytes = Buffer.from(sourcemapContent, 'utf-8')

  const lengthPrefix = (length: number): Buffer => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(BigInt(length))

    return buf
  }

  const hash = crypto.createHash('sha1')
  hash.update('js')
  hash.update(lengthPrefix(jsBytes.length))
  hash.update(jsBytes)
  hash.update('sourcemap')
  hash.update(lengthPrefix(sourcemapBytes.length))
  hash.update(sourcemapBytes)

  const bytes = hash.digest().subarray(0, 16)
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const PRE_INJECTION_SOURCE_NAME = 'pre-injection.js'

// The snippet is inserted as early as possible (after an optional hashbang and/or
// leading "use ...;" directives, which are kept first since they must remain the first
// statements in the file), and a `//# debugId=` comment is appended near the end,
// ahead of a final sourceMappingURL directive when one is present.
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

  const debugIdComment = `${DEBUG_ID_COMMENT_PREFIX}=${debugId}`
  const sourceMappingURLMatch = jsContent.match(SOURCE_MAPPING_URL_REGEX)
  const debugIdCommentPosition = sourceMappingURLMatch?.index ?? jsContent.length

  const originalSourcemap = JSON.parse(sourcemapContent) as RawSourceMap
  const source = new SourceMapSource(jsContent, PRE_INJECTION_SOURCE_NAME, originalSourcemap)
  const injected = new ReplaceSource(source)
  injected.insert(hashbangPortion.length, `${useDirectives}${buildSnippet(debugId)}\n`)
  injected.insert(debugIdCommentPosition, `\n${debugIdComment}\n`)

  const {source: injectedSource, map} = injected.sourceAndMap({columns: true})
  if (!map) {
    throw new Error('Failed to generate the adjusted sourcemap')
  }

  const combinedMap = {...map, debugId, debug_id: debugId}

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
 * Replaces a bundle and sourcemap as one rollback-safe operation. Both new files are
 * fully staged beside their destinations before the originals are moved. If either
 * staged file cannot be promoted, every original that was moved is restored.
 */
const replaceArtifactPair = (
  minifiedFilePath: string,
  jsContent: string,
  sourcemapPath: string,
  sourcemapContent: string
): void => {
  const transactionId = `${process.pid}-${crypto.randomUUID()}`
  const replacements = [
    {
      backupPath: `${minifiedFilePath}.${transactionId}.backup`,
      content: jsContent,
      filePath: minifiedFilePath,
      stagedPath: `${minifiedFilePath}.${transactionId}.tmp`,
    },
    {
      backupPath: `${sourcemapPath}.${transactionId}.backup`,
      content: sourcemapContent,
      filePath: sourcemapPath,
      stagedPath: `${sourcemapPath}.${transactionId}.tmp`,
    },
  ]

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
 * For every payload with no extracted debug ID, generates one from the minified file
 * and sourcemap contents and injects it into both (unless `dryRun`). Payloads whose
 * files can't be read, or whose sourcemap can't be recomposed (e.g. malformed JSON),
 * are left without a debug ID, which `validatePayload` treats as a skip further
 * downstream, instead of aborting the whole batch.
 */
export const injectMissingDebugIds = (payloads: Sourcemap[], dryRun: boolean, stdout: Writable): InjectionResult => {
  const result: InjectionResult = {failed: 0, injected: 0, skipped: 0}

  for (const payload of payloads) {
    if (payload.debugId !== undefined) {
      result.skipped++
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

    const debugId = generateDebugId(jsContent, sourcemapContent)
    stdout.write(`Generated debug ID for ${payload.minifiedFilePath}: ${debugId}\n`)

    try {
      const {js, sourcemap} = injectDebugIdSnippet(jsContent, sourcemapContent, debugId)
      if (dryRun) {
        payload.debugId = debugId
        result.injected++
        stdout.write('Dry run: no files modified.\n')
        continue
      }

      replaceArtifactPair(payload.minifiedFilePath, js, payload.sourcemapPath, sourcemap)
      payload.debugId = debugId
      result.injected++
    } catch (error) {
      result.failed++
      stdout.write(`WARN: Failed to inject debug ID into ${payload.minifiedFilePath}: ${error}\n`)
    }
  }

  return result
}
