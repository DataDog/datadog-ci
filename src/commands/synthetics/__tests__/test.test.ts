import {getTestsFromSearchQuery} from '../test'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {global: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })

  it('should log an error message if too many tests are returned by the search query', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: Array(101)}),
    }
    const config = {global: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })
})
