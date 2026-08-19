import fs from 'fs'
import os from 'os'
import {Writable} from 'stream'

import {SourceMapConsumer, SourceMapGenerator} from 'source-map'
import upath from 'upath'

import {
  addDebugIdToPayloads,
  extractDebugId,
  extractSourcemapDebugId,
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

  describe('snippet formats', () => {
    test.each([
      [`{"ddDebugId":"${DEBUG_ID}"}`],
      [`{"ddDebugId": "${DEBUG_ID}"}`],
      [`{"ddDebugId" : "${DEBUG_ID}"}`],
      [`{"ddDebugId"   :   "${DEBUG_ID}"}`],
      [`{"ddDebugId"\t:\t"${DEBUG_ID}"}`],
      [`{'ddDebugId': '${DEBUG_ID}'}`],
      [`var x=1;({"ddDebugId":"${DEBUG_ID}"});var y=2;`],
      [`var x=1;\n{"ddDebugId": "${DEBUG_ID}"}\nvar y=2;`],
    ])('%s', (content: string) => {
      withTempDirectory((directory) => {
        const filePath = upath.join(directory, 'bundle.js')
        fs.writeFileSync(filePath, content)
        expect(extractDebugId(filePath)).toBe(DEBUG_ID)
      })
    })

    test('finds the trailing debug ID comment without reading a whole large bundle into memory', () => {
      withTempDirectory((directory) => {
        const filePath = upath.join(directory, 'bundle.js')
        fs.writeFileSync(filePath, `${'x'.repeat(1024 * 1024 + 1)}\n//# debugId=${DEBUG_ID}`)
        expect(extractDebugId(filePath)).toBe(DEBUG_ID)
      })
    })
  })

  describe('missing or unreadable', () => {
    test('returns undefined when snippet is absent', () => {
      withTempDirectory((directory) => {
        const filePath = upath.join(directory, 'bundle.js')
        fs.writeFileSync(filePath, 'var x = 1; console.log("hello");')
        expect(extractDebugId(filePath)).toBeUndefined()
      })
    })

    test('returns undefined when file cannot be read', () => {
      expect(extractDebugId('nonexistent.js')).toBeUndefined()
    })
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

      addDebugIdToPayloads([withId, withoutId])

      expect(withId.debugId).toBe(DEBUG_ID)
      expect(withoutId.debugId).toBeUndefined()
    })
  })
})

describe('extractSourcemapDebugId', () => {
  test.each(['debugId', 'debug_id'])('extracts the %s field', (field) => {
    expect(extractSourcemapDebugId(JSON.stringify({version: 3, [field]: DEBUG_ID}))).toBe(DEBUG_ID)
  })

  test('rejects mismatched debug ID fields', () => {
    expect(() =>
      extractSourcemapDebugId(
        JSON.stringify({version: 3, debugId: DEBUG_ID, debug_id: '5c1d7f52-4e1b-5f7c-8c0d-2f4a5f6d8e91'})
      )
    ).toThrow('do not match')
  })
})

describe('generateDebugId', () => {
  const js = 'var x = 1;'
  const sourcemap = '{"version":3,"sources":[],"mappings":""}'

  test('is deterministic for the same inputs', () => {
    expect(generateDebugId(js, sourcemap)).toBe(generateDebugId(js, sourcemap))
  })

  test.each([
    ['JS content', 'var x = 2;', sourcemap],
    ['sourcemap content', js, '{"version":3,"sources":[],"mappings":";;"}'],
  ])('changes when the %s changes', (_description, changedJs, changedSourcemap) => {
    expect(generateDebugId(js, sourcemap)).not.toBe(generateDebugId(changedJs, changedSourcemap))
  })

  test('produces a UUID with version 5 and RFC4122 variant bits forced', () => {
    const id = generateDebugId(js, sourcemap)
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
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
    expect(result.js.trimEnd().endsWith(`//# debugId=${DEBUG_ID_2}`)).toBe(true)
    expect(parsed.debugId).toBe(DEBUG_ID_2)
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
