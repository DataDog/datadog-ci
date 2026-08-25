import fs from 'fs'
import os from 'os'
import vm from 'vm'

import upath from 'upath'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {SourcemapsInjectCommand} from '../inject'

const runCLI = makeRunCLI(SourcemapsInjectCommand, ['sourcemaps', 'inject'])

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

  test('injects a debug ID into the bundle and records it in sourcemap metadata', async () => {
    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    const js = fs.readFileSync(jsPath, 'utf-8')
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {
      debugId?: string
      debug_id?: string
    }
    const debugId = js.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]

    expect(debugId).toBeDefined()
    expect(js).not.toContain('//# debugId=')
    expect(js.trimEnd().endsWith('//# sourceMappingURL=bundle.js.map')).toBe(true)
    expect(sourcemap.debugId).toBeUndefined()
    expect(sourcemap.debug_id).toBe(debugId)
    expect(context.stdout.toString()).toContain('Injected debug IDs into 1 file(s)')
    expect(context.stdout.toString()).toContain('failed 0 file(s)')
  })

  test('preserves semicolonless directives and strict mode through the command', async () => {
    fs.writeFileSync(
      jsPath,
      '"use strict"\n"custom mode"\nglobalThis.strictResult = (function () { return this === undefined })();\n//# sourceMappingURL=bundle.js.map'
    )

    expect((await runCLI([directory])).code).toBe(0)

    const injectedJs = fs.readFileSync(jsPath, 'utf-8')
    const snippetIndex = injectedJs.indexOf('DD_SOURCE_CODE_CONTEXT')
    const context: Record<string, unknown> = {}
    vm.runInNewContext(injectedJs, context)

    expect(injectedJs.indexOf('"use strict"')).toBeLessThan(snippetIndex)
    expect(injectedJs.indexOf('"custom mode"')).toBeLessThan(snippetIndex)
    expect(injectedJs.match(/"use strict"/g)).toHaveLength(1)
    expect(injectedJs.match(/"custom mode"/g)).toHaveLength(1)
    expect(context.strictResult).toBe(true)
  })

  test('reads each sourcemap only once during injection', async () => {
    const readFileSpy = jest.spyOn(fs, 'readFileSync')

    expect((await runCLI([directory])).code).toBe(0)

    const sourcemapReads = readFileSpy.mock.calls.filter(([filePath]) => filePath === sourcemapPath)
    expect(sourcemapReads).toHaveLength(1)
  })

  test('records an existing build-plugin debug ID when the sourcemap has no debug_id', async () => {
    expect((await runCLI([directory])).code).toBe(0)
    const injectedJs = fs.readFileSync(jsPath, 'utf-8')
    const debugId = injectedJs.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as Record<string, unknown>
    delete sourcemap.debug_id
    fs.writeFileSync(sourcemapPath, JSON.stringify(sourcemap))

    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(injectedJs)
    const updatedSourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {debug_id?: string}
    expect(updatedSourcemap.debug_id).toBe(debugId)
    expect(context.stdout.toString()).toContain('Injected debug IDs into 1 file(s)')
  })

  test('replaces a mismatched sourcemap debug_id with the existing bundle debug ID', async () => {
    expect((await runCLI([directory])).code).toBe(0)
    const injectedJs = fs.readFileSync(jsPath, 'utf-8')
    const debugId = injectedJs.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as Record<string, unknown>
    sourcemap.debug_id = '00000000-0000-4000-8000-000000000000'
    fs.writeFileSync(sourcemapPath, JSON.stringify(sourcemap))

    expect((await runCLI([directory])).code).toBe(0)

    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(injectedJs)
    const updatedSourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {debug_id?: string}
    expect(updatedSourcemap.debug_id).toBe(debugId)
  })

  test('validates but does not record an existing bundle debug ID during dry-run', async () => {
    expect((await runCLI([directory])).code).toBe(0)
    const injectedJs = fs.readFileSync(jsPath, 'utf-8')
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as Record<string, unknown>
    delete sourcemap.debug_id
    fs.writeFileSync(sourcemapPath, JSON.stringify(sourcemap))
    const sourcemapWithoutDebugId = fs.readFileSync(sourcemapPath, 'utf-8')

    const {context, code} = await runCLI([directory, '--dry-run'])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(injectedJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(sourcemapWithoutDebugId)
    expect(context.stdout.toString()).toContain('Would inject debug IDs into 1 file(s)')
  })

  test('accepts --max-concurrency', async () => {
    expect((await runCLI([directory, '--max-concurrency', '1'])).code).toBe(0)
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

  test('skips a sourcemap with no mappings without modifying either file', async () => {
    fs.writeFileSync(
      sourcemapPath,
      JSON.stringify({version: 3, sources: [], sourcesContent: [], names: [], mappings: ''})
    )
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    const originalSourcemap = fs.readFileSync(sourcemapPath, 'utf-8')

    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(originalSourcemap)
    expect(context.stdout.toString()).toContain(`Skipped ${sourcemapPath}: sourcemap contains no mappings.`)
    expect(context.stdout.toString()).toContain('skipped 1 file(s); failed 0 file(s)')
  })

  test('skips an empty sourcemap during dry-run without modifying either file', async () => {
    fs.writeFileSync(sourcemapPath, JSON.stringify({version: 3, sources: [], names: [], mappings: ''}))
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    const originalSourcemap = fs.readFileSync(sourcemapPath, 'utf-8')

    const {context, code} = await runCLI([directory, '--dry-run'])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(originalSourcemap)
    expect(context.stdout.toString()).toContain('skipped 1 file(s); failed 0 file(s)')
  })

  test('skips an empty sourcemap when its bundle already contains a debug ID', async () => {
    const debugId = '00000000-0000-4000-8000-000000000000'
    fs.writeFileSync(jsPath, `window.context={"ddDebugId":"${debugId}"};\n//# sourceMappingURL=bundle.js.map`)
    fs.writeFileSync(sourcemapPath, JSON.stringify({version: 3, sources: [], names: [], mappings: ''}))
    const originalJs = fs.readFileSync(jsPath, 'utf-8')
    const originalSourcemap = fs.readFileSync(sourcemapPath, 'utf-8')

    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(originalJs)
    expect(fs.readFileSync(sourcemapPath, 'utf-8')).toBe(originalSourcemap)
    expect(context.stdout.toString()).toContain('skipped 1 file(s); failed 0 file(s)')
  })

  test('injects mapped bundles and skips empty sourcemaps in the same batch', async () => {
    fs.writeFileSync(sourcemapPath, JSON.stringify({version: 3, sources: [], names: [], mappings: ''}))
    const emptyJs = fs.readFileSync(jsPath, 'utf-8')
    const mappedJsPath = upath.join(directory, 'mapped.js')
    fs.writeFileSync(mappedJsPath, 'console.log("mapped");\n//# sourceMappingURL=mapped.js.map')
    fs.writeFileSync(
      `${mappedJsPath}.map`,
      JSON.stringify({version: 3, sources: ['mapped.ts'], sourcesContent: ['console.log("mapped");'], mappings: 'AAAA'})
    )

    const {context, code} = await runCLI([directory])

    expect(code).toBe(0)
    expect(fs.readFileSync(jsPath, 'utf-8')).toBe(emptyJs)
    expect(fs.readFileSync(mappedJsPath, 'utf-8')).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(context.stdout.toString()).toContain(
      'Injected debug IDs into 1 file(s); skipped 1 file(s); failed 0 file(s)'
    )
  })

  test('does not treat a sourcemap with a missing mappings field as empty', async () => {
    fs.writeFileSync(sourcemapPath, JSON.stringify({version: 3, sources: [], names: []}))

    const {context, code} = await runCLI([directory])

    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('WARN: Failed to inject debug ID')
    expect(context.stdout.toString()).not.toContain('sourcemap contains no mappings')
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
    expect(context.stdout.toString()).not.toContain('Generated debug ID')
  })

  test('records an existing bundle debug ID in indexed sourcemap metadata', async () => {
    const debugId = '00000000-0000-4000-8000-000000000000'
    fs.writeFileSync(jsPath, `window.context={"ddDebugId":"${debugId}"};\n//# sourceMappingURL=bundle.js.map`)
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

    expect(code).toBe(0)
    const updatedSourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {debug_id?: string}
    expect(updatedSourcemap.debug_id).toBe(debugId)
    expect(context.stdout.toString()).toContain(`Recorded existing debug ID in ${sourcemapPath}: ${debugId}`)
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
    const injectedSourcemap = JSON.parse(fs.readFileSync(sourcemapPath, 'utf-8')) as {debug_id?: string}
    const debugId = injectedJs.match(/"ddDebugId":"([a-f0-9-]+)"/)?.[1]
    expect(debugId).toBeDefined()
    expect(injectedSourcemap.debug_id).toBe(debugId)
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
