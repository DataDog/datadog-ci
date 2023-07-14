import {replaceForwardSlashes} from '../file'

describe('file util', () => {
  describe('getSafeFileName', () => {
    it('returns same file name if the file name is safe', () => {
      const safeFileName = replaceForwardSlashes('myfilename')
      expect(safeFileName).toBe('myfilename')
    })
    test('filters unsafe characters out', () => {
      expect(replaceForwardSlashes('tests/reports/junit/integration.xml')).toEqual(
        'tests\\reports\\junit\\integration.xml'
      )
    })
  })
})
