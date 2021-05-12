import {getSafeFileName} from '../api'

describe('getSafeFileName', () => {
  test('filters unsafe characters out', () => {
    expect(getSafeFileName('http://gitlab.com/-/pipelines/12345')).toEqual('http___gitlab_com___pipelines_12345')
  })
})
