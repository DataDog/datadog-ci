import {getSafeFileName} from '../file'

describe('file util', () => {
  describe('getSafeFileName', () => {
    it('returns same file name if the file name is safe', () => {
      const safeFileName = getSafeFileName('myfilename')
      expect(safeFileName).toBe('myfilename')
    })
    test('filters unsafe characters out', () => {
      expect(getSafeFileName('tests/reports/junit/integration.xml')).toEqual('tests\\reports\\junit\\integration.xml')
    })
  })
})
