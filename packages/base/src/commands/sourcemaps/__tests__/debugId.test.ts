import fs from 'fs'

import {addDebugIdToPayloads, extractDebugId} from '../debugId'
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
