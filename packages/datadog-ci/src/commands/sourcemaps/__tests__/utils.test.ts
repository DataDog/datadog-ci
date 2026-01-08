import {extractRepeatedPath, getMinifiedFilePath, readLastLine} from '../utils'

describe('utils', () => {
  describe('readLastLine', () => {
    test('should return the last non-empty line from a file', async () => {
      const result = await readLastLine('./src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js')
      expect(result).toBe('/* not empty */')
    })

    test('should handle files with trailing newlines', async () => {
      const result = await readLastLine('./src/commands/sourcemaps/__tests__/fixtures/with-sourcemap-url/bundle.min.js')
      expect(result).toBe('//# sourceMappingURL=some-random-hash.js.map')
    })
  })

  describe('getMinifiedFilePath', () => {
    test('should return correct minified path', () => {
      const file1 = 'sourcemaps/file1.min.js.map'
      const file2 = 'sourcemaps/file2.js.map.xxx'

      expect(getMinifiedFilePath(file1)).toBe('sourcemaps/file1.min.js')
      expect(() => getMinifiedFilePath(file2)).toThrow(
        'cannot get minified file path from a file which is not a sourcemap'
      )
    })
  })

  describe('arelastFoldersRepeated', () => {
    test('should return true', () => {
      const minifiedPathPrefix = 'https://subdomain.domain.dev/static/js'
      const relativePath = '/static/js/1.23.chunk.js'

      expect(extractRepeatedPath(minifiedPathPrefix, relativePath)).toBe('static/js')
    })

    test('should return true 2', () => {
      const minifiedPathPrefix = 'https://subdomain.domain.dev/static/js/'
      const relativePath = '/static/js/1.23.chunk.js'

      expect(extractRepeatedPath(minifiedPathPrefix, relativePath)).toBe('static/js')
    })

    test('should return false', () => {
      const minifiedPathPrefix = 'https://subdomain.domain.dev/static/js'
      const relativePath = '/1.23.chunk.js'

      expect(extractRepeatedPath(minifiedPathPrefix, relativePath)).toBe(undefined)
    })
  })
})
