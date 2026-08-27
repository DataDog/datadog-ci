import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {extractSourcemapDebugId, SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES} from '../sourcemapDebugId'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'

const withSourcemap = async (content: string, callback: (path: string) => Promise<void>): Promise<void> => {
  const directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-sourcemap-debug-id-'))
  try {
    const sourcemapPath = upath.join(directory, 'bundle.js.map')
    fs.writeFileSync(sourcemapPath, content)
    await callback(sourcemapPath)
  } finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('extractSourcemapDebugId', () => {
  test('extracts a top-level debug ID without reading a large sourcesContent value into memory', async () => {
    const nestedDebugId = '00000000-0000-4000-8000-000000000000'
    const sourcesContent = `const nested = {"debug_id":"${nestedDebugId}"};${'x'.repeat(
      SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES * 3
    )}`
    const sourcemap = JSON.stringify({version: 3, sourcesContent: [sourcesContent], mappings: '', debug_id: DEBUG_ID})

    await withSourcemap(sourcemap, async (sourcemapPath) => {
      await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({debugId: DEBUG_ID})
    })
  })

  test('extracts a debug ID whose property is split across chunks', async () => {
    const prefix = '{"sourcesContent":["'
    const separator = '"],'
    const paddingLength = SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES - prefix.length - separator.length - 4
    const sourcemap = `${prefix}${'x'.repeat(paddingLength)}${separator}"debug_id":"${DEBUG_ID}"}`

    await withSourcemap(sourcemap, async (sourcemapPath) => {
      await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({debugId: DEBUG_ID})
    })
  })

  test('ignores nested debug_id properties', async () => {
    await withSourcemap(
      JSON.stringify({version: 3, metadata: {debug_id: DEBUG_ID}, mappings: ''}),
      async (sourcemapPath) => {
        await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({})
      }
    )
  })

  test('reports an invalid top-level debug ID', async () => {
    await withSourcemap('{"version":3,"debug_id":"invalid"}', async (sourcemapPath) => {
      await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({
        error: 'sourcemap contains an invalid debug_id',
      })
    })
  })

  test('reports a non-string top-level debug ID', async () => {
    await withSourcemap('{"version":3,"debug_id":123}', async (sourcemapPath) => {
      await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({
        error: 'sourcemap contains an invalid debug_id',
      })
    })
  })

  test('reports malformed JSON', async () => {
    await withSourcemap('not-json', async (sourcemapPath) => {
      await expect(extractSourcemapDebugId(sourcemapPath)).resolves.toEqual({
        error: 'sourcemap must be a JSON object',
      })
    })
  })

  test('reports file read errors', async () => {
    const result = await extractSourcemapDebugId('/path/that/does/not/exist.js.map')

    expect(result.debugId).toBeUndefined()
    expect(result.error).toContain('ENOENT')
  })
})
