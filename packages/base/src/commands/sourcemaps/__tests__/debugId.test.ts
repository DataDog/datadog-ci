import fs from 'fs'
import os from 'os'
import {Writable} from 'stream'

import {SourceMapConsumer, SourceMapGenerator} from 'source-map'
import upath from 'upath'

import {
  addDebugIdToPayloads,
  DEBUG_ID_SEARCH_CHUNK_BYTES,
  extractDebugId,
  generateDebugId,
  injectMissingDebugIds,
  injectDebugIdSnippet,
} from '../debugId'
import {Sourcemap} from '../interfaces'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'

const makeSourcemap = (minifiedFilePath: string) =>
  new Sourcemap(minifiedFilePath, `https://static.com/${minifiedFilePath}`, `${minifiedFilePath}.map`, minifiedFilePath)

const withTempDirectory = (callback: (directory: string) => void): void => {
  const directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-debug-id-'))
  try {
    callback(directory)
  } finally {
    fs.rmSync(directory, {recursive: true, force: true})
  }
}

describe('extractDebugId', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('extracts a quoted debug ID key', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'quoted.min.js')
      fs.writeFileSync(
        filePath,
        `!function(){}({"service":"app","version":"1.0.0","ddDebugId":"${DEBUG_ID}"},"DD_SOURCE_CODE_CONTEXT");`
      )

      expect(extractDebugId(filePath)).toBe(DEBUG_ID)
    })
  })

  test('extracts an unquoted debug ID key', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'unquoted.min.js')
      fs.writeFileSync(
        filePath,
        `!function(){}({service:"app",version:"1.0.0",ddDebugId:"${DEBUG_ID}"},"DD_SOURCE_CODE_CONTEXT");`
      )

      expect(extractDebugId(filePath)).toBe(DEBUG_ID)
    })
  })

  test('stops reading after finding the debug ID in the first chunk', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'first-chunk.min.js')
      fs.writeFileSync(filePath, `ddDebugId:"${DEBUG_ID}"${'x'.repeat(DEBUG_ID_SEARCH_CHUNK_BYTES * 2)}`)
      const readSync = fs.readSync
      const readSpy = jest.spyOn(fs, 'readSync').mockImplementation(readSync)

      expect(extractDebugId(filePath)).toBe(DEBUG_ID)
      expect(readSpy).toHaveBeenCalledTimes(1)
    })
  })

  test('returns undefined when the snippet is absent', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'no-debug-id.min.js')
      fs.writeFileSync(filePath, '!function(){}({service:"app",version:"1.0.0"},"DD_SOURCE_CODE_CONTEXT");')

      expect(extractDebugId(filePath)).toBeUndefined()
    })
  })

  test('progressively finds a debug ID after the first chunk', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'later-debug-id.min.js')
      fs.writeFileSync(filePath, `${'x'.repeat(DEBUG_ID_SEARCH_CHUNK_BYTES + 100)}ddDebugId:"${DEBUG_ID}"`)

      expect(extractDebugId(filePath)).toBe(DEBUG_ID)
    })
  })

  test('finds a debug ID split across two chunks', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'split-debug-id.min.js')
      const literal = `ddDebugId:"${DEBUG_ID}"`
      const literalPrefixBytes = 20
      fs.writeFileSync(filePath, `${'x'.repeat(DEBUG_ID_SEARCH_CHUNK_BYTES - literalPrefixBytes)}${literal}`)

      expect(extractDebugId(filePath)).toBe(DEBUG_ID)
    })
  })

  test('scans to EOF and returns undefined when a large file has no debug ID', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'large-no-debug-id.min.js')
      fs.writeFileSync(filePath, 'x'.repeat(DEBUG_ID_SEARCH_CHUNK_BYTES * 3 + 100))

      expect(extractDebugId(filePath)).toBeUndefined()
    })
  })

  test('returns undefined when the file cannot be read', () => {
    expect(extractDebugId('nonexistent.js')).toBeUndefined()
  })
})

describe('addDebugIdToPayloads', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('stores extracted debug IDs on payloads', () => {
    withTempDirectory((directory) => {
      const withIdPath = upath.join(directory, 'a.min.js')
      const withoutIdPath = upath.join(directory, 'b.min.js')
      fs.writeFileSync(withIdPath, `{"ddDebugId":"${DEBUG_ID}"}`)
      fs.writeFileSync(withoutIdPath, 'var x = 1;')
      const withId = makeSourcemap(withIdPath)
      const withoutId = makeSourcemap(withoutIdPath)

      const hasAnyDebugId = addDebugIdToPayloads([withId, withoutId])

      expect(hasAnyDebugId).toBe(true)
      expect(withId.debugId).toBe(DEBUG_ID)
      expect(withoutId.debugId).toBeUndefined()
    })
  })

  test('returns false when no payload contains a debug ID', () => {
    withTempDirectory((directory) => {
      const filePath = upath.join(directory, 'bundle.js')
      fs.writeFileSync(filePath, 'var x = 1;')

      expect(addDebugIdToPayloads([makeSourcemap(filePath)])).toBe(false)
    })
  })
})

describe('generateDebugId', () => {
  const js = 'var x = 1;'

  test('matches the build-plugins strategy', () => {
    expect(generateDebugId(js)).toBe('f677d6b7-70cd-4f5e-a8fa-d6423f762295')
  })

  test('changes when the JavaScript changes', () => {
    expect(generateDebugId(js)).not.toBe(generateDebugId('var x = 2;'))
  })

  test('produces a UUID with version 4 and RFC4122 variant bits forced', () => {
    expect(generateDebugId(js)).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  })
})

describe('injectDebugIdSnippet', () => {
  const DEBUG_ID_2 = '5c1d7f52-4e1b-5f7c-8c0d-2f4a5f6d8e91'
  const ORIGINAL_SOURCE_NAME = 'original.js'

  // Builds an identity sourcemap (as if `js` went through minification with no
  // actual transform) naming `original.js` as its one source, so tests can assert
  // that a known original-source position still resolves correctly after injection.
  const buildIdentitySourcemap = (js: string): string => {
    const generator = new SourceMapGenerator()
    js.split('\n').forEach((line, lineIndex) => {
      for (let column = 0; column < line.length; column++) {
        generator.addMapping({
          generated: {line: lineIndex + 1, column},
          original: {line: lineIndex + 1, column},
          source: ORIGINAL_SOURCE_NAME,
        })
      }
    })
    generator.setSourceContent(ORIGINAL_SOURCE_NAME, js)

    return generator.toString()
  }

  const originalPositionFor = async (sourcemap: string, line: number, column: number) =>
    SourceMapConsumer.with(sourcemap, undefined, (consumer) => consumer.originalPositionFor({line, column}))

  test('injects the debug ID while preserving original positions', async () => {
    const js = 'var x = 1;\nconsole.log(x);'
    const sourcemap = buildIdentitySourcemap(js)

    const result = injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const lines = result.js.split('\n')
    const parsed = JSON.parse(result.sourcemap)
    const position = await originalPositionFor(result.sourcemap, 3, 0)

    expect(lines[0]).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(lines[0]).toContain(`"ddDebugId":"${DEBUG_ID_2}"`)
    expect(result.js).toContain(js)
    expect(result.js).not.toContain('//# debugId=')
    expect(parsed.debugId).toBeUndefined()
    expect(parsed.debug_id).toBe(DEBUG_ID_2)
    expect(position.source).toBe(ORIGINAL_SOURCE_NAME)
    expect(position.line).toBe(2)
    expect(position.column).toBe(0)
  })

  test('still resolves positions when the original sourcemap has no mapping at column 0 of its line', async () => {
    // Real minifiers/bundlers routinely emit an unmapped IIFE/wrapper prefix before the
    // first real token on an otherwise fully-packed single line (this is exactly what
    // esbuild does). A lo-res adjustment map anchors each line at column 0, so if that
    // exact column has no mapping in the underlying sourcemap, the whole line's
    // composition is silently dropped. This guards against that regression.
    const originalSource = 'console.log(x);'
    const wrapper = '(function(){'
    const js = `${wrapper}${originalSource}})();`
    const generator = new SourceMapGenerator()
    for (let column = 0; column < originalSource.length; column++) {
      generator.addMapping({
        generated: {line: 1, column: wrapper.length + column},
        original: {line: 1, column},
        source: ORIGINAL_SOURCE_NAME,
      })
    }
    generator.setSourceContent(ORIGINAL_SOURCE_NAME, originalSource)
    const sourcemap = generator.toString()

    // Column 0 is inside the prepended wrapper text, which has no mapping back to
    // `original.js` — confirms the fixture actually reproduces the real-world gap.
    expect((await originalPositionFor(sourcemap, 1, 0)).source).toBeNull()

    const result = injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)

    // `console.log` starts right after the prepended `(function(){` wrapper, on what
    // is now the second generated line (after the injected snippet).
    const wrapperLength = wrapper.length
    const position = await originalPositionFor(result.sourcemap, 2, wrapperLength)

    expect(position.source).toBe(ORIGINAL_SOURCE_NAME)
    expect(position.line).toBe(1)
    expect(position.column).toBe(0)
  })

  test('preserves the original file and extension metadata while resolving sourceRoot', () => {
    const original = JSON.parse(buildIdentitySourcemap('var x = 1;')) as Record<string, unknown>
    const sourcemap = JSON.stringify({
      ...original,
      file: 'bundle.js',
      sourceRoot: '/src',
      x_google_ignoreList: [0],
      customField: 'preserved',
    })

    const result = JSON.parse(injectDebugIdSnippet('var x = 1;', sourcemap, DEBUG_ID_2).sourcemap) as Record<
      string,
      unknown
    >

    expect(result.file).toBe('bundle.js')
    expect(result.sourceRoot).toBeUndefined()
    expect(result.sources).toEqual(['/src/original.js'])
    expect(result.x_google_ignoreList).toEqual([0])
    expect(result.customField).toBe('preserved')
    expect(result.debug_id).toBe(DEBUG_ID_2)
  })

  test('rejects indexed sourcemaps with a clear error', () => {
    const indexedSourcemap = JSON.stringify({
      version: 3,
      sections: [{offset: {line: 0, column: 0}, map: JSON.parse(buildIdentitySourcemap('var x = 1;'))}],
    })

    expect(() => injectDebugIdSnippet('var x = 1;', indexedSourcemap, DEBUG_ID_2)).toThrow(
      'Indexed sourcemaps with "sections" are not supported by sourcemaps inject'
    )
  })

  test('keeps a leading hashbang first', () => {
    const js = '#!/usr/bin/env node\nvar x = 1;'
    const result = injectDebugIdSnippet(js, buildIdentitySourcemap(js), DEBUG_ID_2)

    expect(result.js.startsWith('#!/usr/bin/env node\n')).toBe(true)
    expect(result.js).toContain('DD_SOURCE_CODE_CONTEXT')
  })

  test('repeats a leading "use strict" directive before the snippet and still resolves original positions', async () => {
    const js = '"use strict";\nvar x = 1;\nconsole.log(x);'
    const sourcemap = buildIdentitySourcemap(js)

    const result = injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const firstLine = result.js.split('\n')[0]

    expect(firstLine.startsWith('"use strict";')).toBe(true)
    expect(firstLine).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(result.js).toContain(js)

    // `console.log(x);` is the third line of `js` (1-based line 3). The whole,
    // unstripped original source is preserved verbatim starting one generated
    // line after the injected snippet, so it becomes 1-based generated line 4.
    const position = await originalPositionFor(result.sourcemap, 4, 0)

    expect(position.source).toBe(ORIGINAL_SOURCE_NAME)
    expect(position.line).toBe(3)
    expect(position.column).toBe(0)
  })

  test('repeats every leading directive, not just the first, before the snippet', () => {
    const js = '"use asm";\n"use strict";\nvar x = 1;\nconsole.log(x);'
    const sourcemap = buildIdentitySourcemap(js)

    const result = injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const firstLine = result.js.split('\n')[0]

    expect(firstLine.startsWith('"use asm";"use strict";')).toBe(true)
    expect(firstLine).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(result.js).toContain(js)
  })
})

describe('injectMissingDebugIds', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('reports unreadable files without setting a debug ID', () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const payload = makeSourcemap('a.min.js')
    const stdout = new Writable({write: (_chunk, _encoding, callback) => callback()})

    const result = injectMissingDebugIds([payload], false, stdout)

    expect(payload.debugId).toBeUndefined()
    expect(result).toEqual({failed: 1, injected: 0, skipped: 0})
  })
})
