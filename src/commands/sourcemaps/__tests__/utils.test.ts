import {getMinifiedFilePath, islastFolderRepeated, arelastFoldersRepeated} from '../utils'

describe('utils', () => {
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

      expect(arelastFoldersRepeated(minifiedPathPrefix, relativePath)).toBe(true)
      expect(islastFolderRepeated(minifiedPathPrefix, relativePath)).toBe(true)
    })

    test('should return false', () => {
      const minifiedPathPrefix = 'https://subdomain.domain.dev/static/js'
      const relativePath = '/1.23.chunk.js'

      expect(arelastFoldersRepeated(minifiedPathPrefix, relativePath)).toBe(false)
      expect(islastFolderRepeated(minifiedPathPrefix, relativePath)).toBe(false)
    })
  })
  
})
