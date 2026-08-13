import fs from 'fs'
import {Writable} from 'stream'

import {originalPositionFor, TraceMap} from '@jridgewell/trace-mapping'

import {
  addDebugIdToPayloads,
  extractDebugId,
  generateAndInjectMissingDebugIds,
  generateDebugId,
  injectDebugIdSnippet,
} from '../debugId'
import {Sourcemap} from '../interfaces'

const DEBUG_ID = '2f1d7f52-4e1b-4f7c-8c0d-2f4a5f6d8e91'

const makeSourcemap = (minifiedFilePath: string) =>
  new Sourcemap(minifiedFilePath, `https://static.com/${minifiedFilePath}`, `${minifiedFilePath}.map`, minifiedFilePath)

// Mocks fs.readFileSync to return the given content keyed by minified file path.
const mockFilesByPath = (contentByPath: Record<string, string>) => {
  jest.spyOn(fs, 'readFileSync').mockImplementation((path: unknown) => {
    const content = contentByPath[path as string]
    if (content === undefined) {
      throw new Error(`ENOENT: ${String(path)}`)
    }

    return content
  })
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
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(content)
      expect(extractDebugId('bundle.js')).toBe(DEBUG_ID)
    })
  })

  describe('missing or unreadable', () => {
    test('returns undefined when snippet is absent', () => {
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce('var x = 1; console.log("hello");')
      expect(extractDebugId('bundle.js')).toBeUndefined()
    })

    test('returns undefined when file cannot be read', () => {
      jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file or directory')
      })
      expect(extractDebugId('nonexistent.js')).toBeUndefined()
    })
  })
})

describe('addDebugIdToPayloads', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('stores each debug ID on its payload and returns true when any is found', () => {
    mockFilesByPath({
      'a.min.js': `{"ddDebugId":"${DEBUG_ID}"}`,
      'b.min.js': 'var x = 1;',
    })
    const withId = makeSourcemap('a.min.js')
    const withoutId = makeSourcemap('b.min.js')

    expect(addDebugIdToPayloads([withId, withoutId])).toBe(true)
    expect(withId.debugId).toBe(DEBUG_ID)
    expect(withoutId.debugId).toBeUndefined()
  })

  test('returns false when no payload has a debug ID', () => {
    mockFilesByPath({'a.min.js': 'var x = 1;', 'b.min.js': 'var y = 2;'})
    const payloads = [makeSourcemap('a.min.js'), makeSourcemap('b.min.js')]

    expect(addDebugIdToPayloads(payloads)).toBe(false)
    expect(payloads.every((p) => p.debugId === undefined)).toBe(true)
  })
})

describe('generateDebugId', () => {
  const js = 'var x = 1;'
  const sourcemap = '{"version":3,"sources":[],"mappings":""}'

  test('is deterministic for the same inputs', () => {
    expect(generateDebugId(js, sourcemap)).toBe(generateDebugId(js, sourcemap))
  })

  test('changes when the JS content changes', () => {
    expect(generateDebugId(js, sourcemap)).not.toBe(generateDebugId('var x = 2;', sourcemap))
  })

  test('changes when the sourcemap content changes', () => {
    expect(generateDebugId(js, sourcemap)).not.toBe(generateDebugId(js, '{"version":3,"sources":[],"mappings":";;"}'))
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
  const buildIdentitySourcemap = async (js: string): Promise<string> => {
    const {default: MagicString} = await import('magic-string')
    const ms = new MagicString(js)

    return ms.generateMap({source: ORIGINAL_SOURCE_NAME, includeContent: true, hires: true}).toString()
  }

  test('prepends the DD_SOURCE_CODE_CONTEXT snippet as the new first line and appends the debugId comment', async () => {
    const js = 'var x = 1;\nconsole.log(x);'
    const sourcemap = await buildIdentitySourcemap(js)

    const result = await injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const lines = result.js.split('\n')

    expect(lines[0]).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(lines[0]).toContain(`"ddDebugId":"${DEBUG_ID_2}"`)
    expect(result.js).toContain(js)
    expect(result.js.trimEnd().endsWith(`//# debugId=${DEBUG_ID_2}`)).toBe(true)
  })

  test('round-trips through extractDebugId', async () => {
    const injected = await injectDebugIdSnippet('var x = 1;', await buildIdentitySourcemap('var x = 1;'), DEBUG_ID_2)
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => injected.js)
    expect(extractDebugId('bundle.js')).toBe(DEBUG_ID_2)
    jest.restoreAllMocks()
  })

  test('sets debugId on the recomposed sourcemap and still resolves a known original position', async () => {
    const js = 'var x = 1;\nconsole.log(x);'
    const sourcemap = await buildIdentitySourcemap(js)

    const result = await injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const parsed = JSON.parse(result.sourcemap)
    expect(parsed.debugId).toBe(DEBUG_ID_2)

    // `console.log(x);` is the second line of `js` (0-based line 1). After
    // injection it becomes the third generated line (1-based line 3, column 0).
    const tracer = new TraceMap(result.sourcemap)
    const position = originalPositionFor(tracer, {line: 3, column: 0})

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
    const {default: MagicString} = await import('magic-string')
    const original = new MagicString('console.log(x);')
    original.prepend('(function(){')
    original.append('})();')
    const js = original.toString()
    const sourcemap = original.generateMap({source: ORIGINAL_SOURCE_NAME, includeContent: true, hires: true}).toString()

    // Column 0 is inside the prepended wrapper text, which has no mapping back to
    // `original.js` — confirms the fixture actually reproduces the real-world gap.
    const originalTracer = new TraceMap(sourcemap)
    expect(originalPositionFor(originalTracer, {line: 1, column: 0}).source).toBeNull()

    const result = await injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)

    // `console.log` starts right after the prepended `(function(){` wrapper, on what
    // is now the second generated line (after the injected snippet).
    const wrapperLength = '(function(){'.length
    const tracer = new TraceMap(result.sourcemap)
    const position = originalPositionFor(tracer, {line: 2, column: wrapperLength})

    expect(position.source).toBe(ORIGINAL_SOURCE_NAME)
    expect(position.line).toBe(1)
    expect(position.column).toBe(0)
  })

  test('keeps a leading hashbang first', async () => {
    const js = '#!/usr/bin/env node\nvar x = 1;'
    const result = await injectDebugIdSnippet(js, await buildIdentitySourcemap(js), DEBUG_ID_2)

    expect(result.js.startsWith('#!/usr/bin/env node\n')).toBe(true)
    expect(result.js).toContain('DD_SOURCE_CODE_CONTEXT')
  })

  test('repeats a leading "use strict" directive before the snippet and still resolves original positions', async () => {
    const js = '"use strict";\nvar x = 1;\nconsole.log(x);'
    const sourcemap = await buildIdentitySourcemap(js)

    const result = await injectDebugIdSnippet(js, sourcemap, DEBUG_ID_2)
    const firstLine = result.js.split('\n')[0]

    expect(firstLine.startsWith('"use strict";')).toBe(true)
    expect(firstLine).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(result.js).toContain(js)

    // `console.log(x);` is the third line of `js` (1-based line 3). The whole,
    // unstripped original source is preserved verbatim starting one generated
    // line after the injected snippet, so it becomes 1-based generated line 4.
    const tracer = new TraceMap(result.sourcemap)
    const position = originalPositionFor(tracer, {line: 4, column: 0})

    expect(position.source).toBe(ORIGINAL_SOURCE_NAME)
    expect(position.line).toBe(3)
    expect(position.column).toBe(0)
  })
})

describe('generateAndInjectMissingDebugIds', () => {
  const makeStdout = () => {
    const chunks: string[] = []
    const stdout = new Writable({
      write: (chunk, _enc, callback) => {
        chunks.push(chunk.toString())
        callback()
      },
    })

    return {stdout, chunks}
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('generates and injects a debug ID for payloads missing one', async () => {
    const files: Record<string, string> = {
      'a.min.js': 'var x = 1;',
      'a.min.js.map': JSON.stringify({version: 3, sources: ['a.min.js'], mappings: 'AAAA'}),
    }
    jest.spyOn(fs, 'readFileSync').mockImplementation((path: unknown) => files[path as string])
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((path: unknown, content: unknown) => {
      files[path as string] = content as string
    })

    const payload = makeSourcemap('a.min.js')
    const {stdout, chunks} = makeStdout()

    await generateAndInjectMissingDebugIds([payload], false, stdout)

    expect(payload.debugId).toBeDefined()
    expect(chunks.join('')).toContain(payload.debugId)
    expect(writeSpy).toHaveBeenCalledTimes(2)
    expect(files['a.min.js']).toContain('DD_SOURCE_CODE_CONTEXT')
    expect(JSON.parse(files['a.min.js.map']).debugId).toBe(payload.debugId)
  })

  test('computes and sets debugId but does not write files on dry run', async () => {
    const files: Record<string, string> = {
      'a.min.js': 'var x = 1;',
      'a.min.js.map': JSON.stringify({version: 3, sources: ['a.min.js'], mappings: 'AAAA'}),
    }
    jest.spyOn(fs, 'readFileSync').mockImplementation((path: unknown) => files[path as string])
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

    const payload = makeSourcemap('a.min.js')
    const {stdout} = makeStdout()

    await generateAndInjectMissingDebugIds([payload], true, stdout)

    expect(payload.debugId).toBeDefined()
    expect(writeSpy).not.toHaveBeenCalled()
  })

  test('skips payloads that already have a debug ID', async () => {
    const readSpy = jest.spyOn(fs, 'readFileSync')
    const payload = makeSourcemap('a.min.js')
    payload.debugId = 'existing-id'
    const {stdout} = makeStdout()

    await generateAndInjectMissingDebugIds([payload], false, stdout)

    expect(payload.debugId).toBe('existing-id')
    expect(readSpy).not.toHaveBeenCalled()
  })

  test('leaves debugId undefined when files cannot be read', async () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const payload = makeSourcemap('a.min.js')
    const {stdout} = makeStdout()

    await generateAndInjectMissingDebugIds([payload], false, stdout)

    expect(payload.debugId).toBeUndefined()
  })
})
