import {getTestsFromSearchQuery} from '../test'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if an empty string is given', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {global: {}, testSearchQuery: ''}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })

  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {global: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })
})
