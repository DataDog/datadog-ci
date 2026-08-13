import crypto from 'crypto'
import fs from 'fs'

import type {Sourcemap} from './interfaces'
import type {Writable} from 'stream'

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

// The runtime snippet read by the browser RUM SDK (packages/browser-core/src/domain/sourceCodeContext.ts),
// matching the shape build-plugins already injects via getSourceCodeContextSnippet.ts.
const buildSnippet = (debugId: string): string =>
  `(function(c,n){try{if(typeof window==='undefined')return;var w=window,m=w[n]=w[n]||{},s=new Error().stack;s&&(m[s]=c)}catch(e){}})({"ddDebugId":"${debugId}"},"DD_SOURCE_CODE_CONTEXT");`

const DEBUG_ID_COMMENT_PREFIX = '//# debugId'

const HASHBANG_REGEX = /^#!.*(?:\r\n|\r|\n)/
const USE_DIRECTIVE_REGEX =
  /^(?:\s|\/\*[\s\S]*?\*\/|\/\/.*(?:\r\n|\r|\n))*(?<useDirective>"use [^"]*"|'use [^']*');?(?:\r\n|\r|\n)?/

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

// Since exactly one new generated line is inserted before the original code, the
// sourcemap only needs a single leading `;` (one empty generated line) prepended to
// its `mappings` field to stay in sync.
const injectDebugIdIntoSourcemap = (sourcemapContent: string, debugId: string): string => {
  const sourcemap = JSON.parse(sourcemapContent)
  sourcemap.mappings = `;${sourcemap.mappings ?? ''}`
  sourcemap.debugId = debugId

  return JSON.stringify(sourcemap)
}

// The snippet is inserted as early as possible (after an optional hashbang and/or
// leading "use ...;" directive, which are kept first since they must remain the first
// statement in the file), and a `//# debugId=` comment is appended at the very end.
const injectDebugIdIntoJs = (jsContent: string, debugId: string): string => {
  const hashbangMatch = jsContent.match(HASHBANG_REGEX)
  const hashbangPortion = hashbangMatch ? hashbangMatch[0] : ''
  const sourceWithoutHashbang = jsContent.slice(hashbangPortion.length)

  const useDirectiveMatch = sourceWithoutHashbang.match(USE_DIRECTIVE_REGEX)
  const useDirective = useDirectiveMatch?.groups?.useDirective ? `${useDirectiveMatch.groups.useDirective};` : ''

  const debugIdComment = `${DEBUG_ID_COMMENT_PREFIX}=${debugId}`

  return `${hashbangPortion}${useDirective}${buildSnippet(debugId)}\n${sourceWithoutHashbang}\n${debugIdComment}\n`
}

export const injectDebugIdSnippet = (
  jsContent: string,
  sourcemapContent: string,
  debugId: string
): {js: string; sourcemap: string} => ({
  js: injectDebugIdIntoJs(jsContent, debugId),
  sourcemap: injectDebugIdIntoSourcemap(sourcemapContent, debugId),
})

/**
 * For every payload with no extracted debug ID, generates one from the minified file
 * and sourcemap contents and injects it into both (unless `dryRun`). Payloads whose
 * files can't be read are left without a debug ID, which `validatePayload` treats as
 * a skip further downstream.
 */
export const generateAndInjectMissingDebugIds = async (
  payloads: Sourcemap[],
  dryRun: boolean,
  stdout: Writable
): Promise<void> => {
  for (const payload of payloads) {
    if (payload.debugId !== undefined) {
      continue
    }

    let jsContent: string
    let sourcemapContent: string
    try {
      jsContent = fs.readFileSync(payload.minifiedFilePath, 'utf-8')
      sourcemapContent = fs.readFileSync(payload.sourcemapPath, 'utf-8')
    } catch {
      continue
    }

    const debugId = generateDebugId(jsContent, sourcemapContent)
    stdout.write(`Generated debug ID for ${payload.minifiedFilePath}: ${debugId}\n`)
    payload.debugId = debugId

    if (dryRun) {
      stdout.write('Dry run: no files modified.\n')
      continue
    }

    const {js, sourcemap} = injectDebugIdSnippet(jsContent, sourcemapContent, debugId)
    fs.writeFileSync(payload.minifiedFilePath, js)
    fs.writeFileSync(payload.sourcemapPath, sourcemap)
  }
}
