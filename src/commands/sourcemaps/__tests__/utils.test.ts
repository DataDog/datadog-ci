import {getMinifiedFilePath} from '../utils'

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
})
