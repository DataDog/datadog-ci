import {buildPath, getMinifiedFilePath} from '../utils'

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
  describe('buildPath', () => {
    test('should return correct path', () => {
      const pathWithNoTrailingSlash = 'sourcemaps/js'
      const pathWithTrailingSlash = 'sourcemaps/js/'
      const fileName = 'file1.min.js'

      expect(buildPath(pathWithNoTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
      expect(buildPath(pathWithTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
    })
  })
})
