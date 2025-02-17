const MOCK_DATA = {
  value: 'false',
}

describe('mock data should be correct', () => {
  it('should return a true value', () => {
    expect(MOCK_DATA.value).toEqual('true')
  })
})
