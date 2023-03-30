import {getSafeFileName} from '../file'

describe('file util', () => {
  describe('getSafeFileName', () => {
    it('returns same file name if the file name is safe', () => {
      const safeFileName = getSafeFileName('myfilename')
      expect(safeFileName).toBe('myfilename')
    })
    test('filters unsafe characters out', () => {
      expect(getSafeFileName('http://gitlab.com/-/pipelines/12345')).toEqual('http___gitlab_com___pipelines_12345')
    })
  })
})
