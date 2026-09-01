import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {SourcemapsFindCommand} from '../find'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'
const OTHER_DEBUG_ID = '00000000-0000-4000-8000-000000000000'

const runCLI = makeRunCLI(SourcemapsFindCommand, ['sourcemaps', 'find'])

describe('sourcemaps find', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-sourcemaps-find-'))
  })

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  const writeSourcemap = (name: string, debugId?: string): string => {
    const sourcemapPath = upath.join(directory, `${name}.js.map`)
    fs.mkdirSync(upath.dirname(sourcemapPath), {recursive: true})
    fs.writeFileSync(
      sourcemapPath,
      JSON.stringify({
        version: 3,
        sources: [`${name}.ts`],
        mappings: 'AAAA',
        ...(debugId ? {debug_id: debugId} : {}),
      })
    )

    return sourcemapPath
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

  test('finds sourcemaps by their top-level debug ID', async () => {
    const matchingPath = writeSourcemap('matching', DEBUG_ID)
    writeSourcemap('unrelated', OTHER_DEBUG_ID)

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID, '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(context.stdout.toString())).toEqual([{debugId: DEBUG_ID, sourcemapPath: matchingPath}])
  })

  test('finds sourcemaps without a top-level debug ID', async () => {
    const firstMissingPath = writeSourcemap('a-missing')
    const secondMissingPath = writeSourcemap('nested/b-missing')
    writeSourcemap('with-id', DEBUG_ID)

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(context.stdout.toString())).toEqual([
      {sourcemapPath: firstMissingPath},
      {sourcemapPath: secondMissingPath},
    ])
  })

  test('does not inspect minified bundles for debug IDs', async () => {
    const sourcemapPath = writeSourcemap('bundle-only')
    fs.writeFileSync(upath.join(directory, 'bundle-only.js'), `({"ddDebugId":"${DEBUG_ID}"},"DD_SOURCE_CODE_CONTEXT");`)

    const missingResult = await runCLI([directory, '--missing-debug-id', '--json'])
    const debugIdResult = await runCLI([directory, '--debug-id', DEBUG_ID, '--json'])

    expect(missingResult.code).toBe(0)
    expect(JSON.parse(missingResult.context.stdout.toString())).toEqual([{sourcemapPath}])
    expect(debugIdResult.code).toBe(1)
    expect(JSON.parse(debugIdResult.context.stdout.toString())).toEqual([])
  })

  test('classifies a sourcemap with no UUID-shaped debug_id as missing', async () => {
    // Malformed JSON and non-UUID debug_id values yield no match, so they surface under
    // --missing-debug-id rather than as inspection errors. Only unreadable files error.
    const malformedPath = upath.join(directory, 'malformed.js.map')
    fs.writeFileSync(malformedPath, 'not-json')
    const invalidPath = writeSourcemap('invalid')
    fs.writeFileSync(invalidPath, JSON.stringify({version: 3, mappings: '', debug_id: 'invalid'}))

    const {context, code} = await runCLI([directory, '--missing-debug-id', '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(context.stdout.toString())).toEqual([
      {sourcemapPath: invalidPath},
      {sourcemapPath: malformedPath},
    ])
    expect(context.stderr.toString()).not.toContain('Could not inspect sourcemap')
  })

  test('returns exit 1 when an exact debug ID has no local match', async () => {
    writeSourcemap('missing')

    const {context, code} = await runCLI([directory, '--debug-id', DEBUG_ID])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain(`No local sourcemap artifacts found for debug ID ${DEBUG_ID}`)
  })

  test('reports when every sourcemap has a debug ID', async () => {
    writeSourcemap('with-id', DEBUG_ID)

    const {context, code} = await runCLI([directory, '--missing-debug-id'])

    expect(code).toBe(0)
    expect(context.stdout.toString()).toContain('All discovered sourcemaps contain a debug ID')
  })

  test('returns exit 1 when no JavaScript sourcemaps are found', async () => {
    fs.writeFileSync(upath.join(directory, 'not-javascript.map'), '{}')

    const {context, code} = await runCLI([directory, '--missing-debug-id'])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('No JavaScript sourcemaps found')
  })

  test('rejects a file path because local search scans a directory', async () => {
    const filePath = writeSourcemap('bundle')

    const {context, code} = await runCLI([filePath, '--missing-debug-id'])

    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(`Path must be a directory: ${filePath}`)
  })
})
