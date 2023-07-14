import {getSafeFilename} from '../file'

describe('getSafeFilename', () => {
  it('returns same file name if the file name is safe', () => {
    expect(getSafeFilename('myfilename')).toBe('myfilename')
  })
  test('filters unsafe characters out', () => {
    expect(getSafeFilename('http://gitlab.com/-/pipelines/12345')).toEqual('http___gitlab_com___pipelines_12345')
  })
})
