import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {DEBUG_ID_ASYNC_SEARCH_CHUNK_BYTES} from '../debugId'
import {SourcemapsFindCommand} from '../find'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'
const OTHER_DEBUG_ID = '00000000-0000-4000-8000-000000000000'

const runCLI = makeRunCLI(SourcemapsFindCommand, ['sourcemaps', 'find'])

describe('sourcemaps find', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-sourcemaps-resolve-'))
  })

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  const writePair = (name: string, bundleDebugId?: string, sourcemapDebugId?: string, bundlePrefix = ''): void => {
    const minifiedFilePath = upath.join(directory, `${name}.js`)
    const debugIdSnippet = bundleDebugId ? `({"ddDebugId":"${bundleDebugId}"});` : ''
    fs.writeFileSync(minifiedFilePath, `${bundlePrefix}${debugIdSnippet}\n//# sourceMappingURL=${name}.js.map`)
    fs.writeFileSync(
      `${minifiedFilePath}.map`,
      JSON.stringify({
        version: 3,
        sources: [`${name}.ts`],
        mappings: 'AAAA',
        ...(sourcemapDebugId ? {debug_id: sourcemapDebugId} : {}),
      })
    )
  }

  test('requires exactly one query option', async () => {
    expect((await runCLI([directory])).code).toBe(1)
    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID, '--missing-debug-id'])

    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Exactly one of --debug-id or --missing-debug-id')
  })

  test('validates the debug ID format', async () => {
    const {context, code} = await runCLI([directory, '--debug-id', 'not-a-debug-id'])

    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('--debug-id must be a UUID')
  })

  test('resolves an ID from either artifact and reports every consistency status', async () => {
    writePair('matched', DEBUG_ID, DEBUG_ID)
    writePair('bundle-only', DEBUG_ID)
    writePair('sourcemap-only', undefined, DEBUG_ID)
    writePair('mismatched', DEBUG_ID, OTHER_DEBUG_ID)
    writePair('unrelated', OTHER_DEBUG_ID, OTHER_DEBUG_ID)

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID, '--json'])
    const results = JSON.parse(context.stdout.toString()) as {status: string}[]

    expect(code).toBe(0)
    expect(results.map(({status}) => status).sort()).toEqual(
      ['bundle-only', 'matched', 'mismatched', 'sourcemap-only'].sort()
    )
  })

  test('finds pairs whose runtime bundle has no debug ID', async () => {
    writePair('missing')
    writePair('sourcemap-only', undefined, DEBUG_ID)
    writePair('bundle-only', DEBUG_ID)

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])
    const results = JSON.parse(context.stdout.toString()) as {
      bundleDebugId?: string
      status: string
    }[]

    expect(code).toBe(0)
    expect(results).toHaveLength(2)
    expect(results.every(({bundleDebugId}) => bundleDebugId === undefined)).toBe(true)
    expect(results.map(({status}) => status).sort()).toEqual(['missing', 'sourcemap-only'])
  })

  test('finds a debug ID beyond the first asynchronous read', async () => {
    writePair('large', DEBUG_ID, DEBUG_ID, 'x'.repeat(DEBUG_ID_ASYNC_SEARCH_CHUNK_BYTES + 100))

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID, '--json'])
    const results = JSON.parse(context.stdout.toString()) as {status: string}[]

    expect(code).toBe(0)
    expect(results).toEqual([expect.objectContaining({status: 'matched'})])
  })

  test('uses sourceMappingURL to pair a non-conventionally named sourcemap', async () => {
    const minifiedFilePath = upath.join(directory, 'bundle.js')
    const sourcemapPath = upath.join(directory, 'generated-artifact.map')
    fs.writeFileSync(minifiedFilePath, `({"ddDebugId":"${DEBUG_ID}"});\n//# sourceMappingURL=generated-artifact.map`)
    fs.writeFileSync(
      sourcemapPath,
      JSON.stringify({version: 3, sources: ['bundle.ts'], mappings: 'AAAA', debug_id: DEBUG_ID})
    )

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID, '--json'])
    const results = JSON.parse(context.stdout.toString()) as {sourcemapPath: string}[]

    expect(code).toBe(0)
    expect(results).toEqual([expect.objectContaining({sourcemapPath})])
  })

  test('reports malformed sourcemaps without hiding a missing runtime ID', async () => {
    writePair('malformed')
    fs.writeFileSync(upath.join(directory, 'malformed.js.map'), 'not-json')

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])
    const results = JSON.parse(context.stdout.toString()) as {sourcemapError?: string; status: string}[]

    expect(code).toBe(0)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('missing')
    expect(typeof results[0].sourcemapError).toBe('string')
  })

  test('reports malformed bundle IDs instead of classifying them as missing', async () => {
    writePair('invalid-bundle', '2f1d7f524e1b--4f7c-8c0d-2f4a5f6d8e91')

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])

    expect(code).toBe(1)
    expect(JSON.parse(context.stdout.toString())).toEqual([])
    expect(context.stderr.toString()).toContain('bundle contains an invalid ddDebugId')
    expect(context.stdout.toString()).not.toContain('"status": "missing"')
  })

  test('reports orphan sourcemaps instead of classifying their absent bundle as missing an ID', async () => {
    fs.writeFileSync(
      upath.join(directory, 'orphan.js.map'),
      JSON.stringify({version: 3, sources: ['orphan.ts'], mappings: ''})
    )

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])

    expect(code).toBe(1)
    expect(JSON.parse(context.stdout.toString())).toEqual([])
    expect(context.stderr.toString()).toContain('Could not inspect bundle')
    expect(context.stderr.toString()).toContain('ENOENT')
  })

  test('returns exit 1 when an exact debug ID has no local match', async () => {
    writePair('missing')

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain(`No local sourcemap artifacts found for debug ID ${DEBUG_ID}`)
  })

  test('returns an empty JSON array when every bundle has a debug ID', async () => {
    writePair('matched', DEBUG_ID, DEBUG_ID)

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(context.stdout.toString())).toEqual([])
  })

  test('rejects a file path because local resolution scans a directory', async () => {
    const filePath = upath.join(directory, 'bundle.js')
    fs.writeFileSync(filePath, '')

    const {context, code} = await runCLI([filePath, '--missing-debug-id'])

    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(`Path must be a directory: ${filePath}`)
  })
})
