import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {SourcemapsInjectCommand} from '../inject'

const runCLI = makeRunCLI(SourcemapsInjectCommand, ['sourcemaps', 'inject'])
const OTHER_DEBUG_ID = '5c1d7f52-4e1b-5f7c-8c0d-2f4a5f6d8e91'

describe('sourcemaps inject', () => {
  let directory: string
  let jsPath: string
  let sourcemapPath: string

  beforeEach(() => {
    directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-sourcemaps-inject-'))
    jsPath = upath.join(directory, 'bundle.js')
    sourcemapPath = `${jsPath}.map`
    fs.writeFileSync(jsPath, 'console.log("hello");\n//# sourceMappingURL=bundle.js.map')
    fs.writeFileSync(
      sourcemapPath,
      JSON.stringify({
        version: 3,
        sources: ['original.js'],
        sourcesContent: ['console.log("hello");'],
        names: [],
        mappings: 'AAAA',
      })
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(directory, {recursive: true, force: true})
  })

  test('injects the same debug ID into a bundle and its sourcemap', async () => {
    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    const js = fs.readFileSync(jsPath, 'utf-8')
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {
      debugId?: string
      debug_id?: string
    }
    const debugId = js.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]

    expect(debugId).toBeDefined()
    expect(js).toContain(`//# debugId=${debugId}`)
    expect(js.trimEnd().endsWith('//# sourceMappingURL=bundle.js.map')).toBe(true)
    expect(sourcemap.debugId).toBe(debugId)
    expect(sourcemap.debug_id).toBe(debugId)
    expect(context.stdout.toString()).toContain('Injected debug IDs into 1 file(s)')
    expect(context.stdout.toString()).toContain('failed 0 file(s)')
  })

  test('is idempotent when a bundle already contains a debug ID', async () => {
    expect((await runCLI([directory])).code).toBe(0)
    const injectedJs = fs.readFileSync(jsPath, 'utf-8')

    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(injectedJs)
    expect(context.stdout.toString()).toContain('skipped 1 file(s) with existing debug IDs')
  })

  test.each([
    ['missing', undefined, '<missing>'],
    ['different', OTHER_DEBUG_ID, OTHER_DEBUG_ID],
  ])('fails when an existing bundle debug ID is %s in its sourcemap', async (_, mapDebugId, expectedMapId) => {
    expect((await runCLI([directory])).code).toBe(0)
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as Record<string, unknown>
    sourcemap.debugId = mapDebugId
    sourcemap.debug_id = mapDebugId
    fs.writeFileSync(sourcemapPath, JSON.stringify(sourcemap))

    const {context, code} = await runCLI([directory])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Existing debug ID validation failed')
    expect(context.stdout.toString()).toContain(`sourcemap debug ID ${expectedMapId}`)
    expect(context.stdout.toString()).toContain('Rebuild the bundle and sourcemap before reinjecting')
  })

  test('does not modify files in dry-run mode', async () => {
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    const originalSourcemap = fs.readFileSync(sourcemapPath, 'utf-8')

    const {context, code} = await runCLI([directory, '--dry-run'])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(originalSourcemap)
    expect(context.stdout.toString()).toContain('Would inject debug IDs into 1 file(s)')
  })

  test('validates malformed sourcemaps in dry-run mode without modifying files', async () => {
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    fs.writeFileSync(sourcemapPath, 'not valid JSON')

    const {context, code} = await runCLI([directory, '--dry-run'])

    expect(code).toBe(1)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe('not valid JSON')
    expect(context.stdout.toString()).toContain('WARN: Failed to inject debug ID')
    expect(context.stdout.toString()).toContain('failed 1 file(s)')
  })

  test('reports indexed sourcemaps as unsupported', async () => {
    fs.writeFileSync(
      sourcemapPath,
      JSON.stringify({
        version: 3,
        sections: [
          {
            offset: {line: 0, column: 0},
            map: {version: 3, sources: ['original.js'], names: [], mappings: 'AAAA'},
          },
        ],
      })
    )

    const {context, code} = await runCLI([directory])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain(
      'Indexed sourcemaps with "sections" are not supported by sourcemaps inject'
    )
  })

  test('does not follow sourcemap references outside the requested directory', async () => {
    const outsideSourcemapPath = `${directory}-outside.map`
    const originalOutsideSourcemap = JSON.stringify({version: 3, sources: ['outside.js'], mappings: 'AAAA'})
    fs.writeFileSync(outsideSourcemapPath, originalOutsideSourcemap)
    fs.writeFileSync(jsPath, `console.log("hello");\n//# sourceMappingURL=../${upath.basename(outsideSourcemapPath)}`)

    try {
      const {context, code} = await runCLI([directory])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('resolves outside')
      expect(fs.readFileSync(outsideSourcemapPath, 'utf-8')).toBe(originalOutsideSourcemap)
      expect(fs.readFileSync(jsPath, 'utf-8')).not.toContain('DD_SOURCE_CODE_CONTEXT')
    } finally {
      fs.rmSync(outsideSourcemapPath, {force: true})
    }
  })

  test('restores both originals when promoting the sourcemap fails and succeeds on retry', async () => {
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    const originalSourcemap = fs.readFileSync(sourcemapPath, 'utf-8')
    const renameSync = fs.renameSync
    let shouldFailSourcemapPromotion = true
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (shouldFailSourcemapPromotion && String(oldPath).endsWith('.tmp') && String(newPath) === sourcemapPath) {
        shouldFailSourcemapPromotion = false
        throw new Error('simulated sourcemap promotion failure')
      }
      renameSync(oldPath, newPath)
    })

    const firstRun = await runCLI([directory])

    expect(firstRun.code).toBe(1)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(originalSourcemap)
    expect(fs.readdirSync(directory).sort()).toEqual(['bundle.js', 'bundle.js.map'])
    expect(firstRun.context.stdout.toString()).toContain('failed 1 file(s)')

    renameSpy.mockRestore()
    const secondRun = await runCLI([directory])

    expect(secondRun.code).toBe(0)
    const injectedJs = fs.readFileSync(jsPath, 'utf-8')
    const injectedSourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {debugId?: string}
    const debugId = injectedJs.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]
    expect(debugId).toBeDefined()
    expect(injectedSourcemap.debugId).toBe(debugId)
  })

  test('continues processing other bundles but exits nonzero when one sourcemap is malformed', async () => {
    fs.writeFileSync(sourcemapPath, 'not valid JSON')
    const validJsPath = upath.join(directory, 'valid.js')
    fs.writeFileSync(validJsPath, 'console.log("valid");\n//# sourceMappingURL=valid.js.map')
    fs.writeFileSync(
      `${validJsPath}.map`,
      JSON.stringify({version: 3, sources: ['valid.ts'], sourcesContent: ['console.log("valid");'], mappings: 'AAAA'})
    )

    const {context, code} = await runCLI([directory])

    expect(code).toBe(1)
    expect(fs.readFileSync(jsPath, 'utf-8')).not.toContain('DD_SOURCE_CODE_CONTEXT')
    expect(fs.readFileSync(validJsPath, 'utf-8')).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(context.stdout.toString()).toContain('WARN: Failed to inject debug ID')
    expect(context.stdout.toString()).toContain('failed 1 file(s)')
  })
})
