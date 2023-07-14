import {replaceForwardSlashes, getSafeFileName} from '../file'

describe('replaceForwardSlashes', () => {
  it('returns same file name if the file name does not include forward slashes', () => {
    expect(replaceForwardSlashes('myfilename')).toBe('myfilename')
  })
  test('replaces forward slashes', () => {
    expect(replaceForwardSlashes('tests/reports/junit/integration.xml')).toEqual(
      'tests\\reports\\junit\\integration.xml'
    )
  })
})

describe('getSafeFileName', () => {
  it('returns same file name if the file name is safe', () => {
    expect(replaceForwardSlashes('myfilename')).toBe('myfilename')
  })
  test('filters unsafe characters out', () => {
    expect(getSafeFileName('http://gitlab.com/-/pipelines/12345')).toEqual('http___gitlab_com___pipelines_12345')
  })
})
