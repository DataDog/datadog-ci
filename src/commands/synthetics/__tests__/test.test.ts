import {RunTestsCommandConfig} from '../interfaces'
import {getTestsFromSearchQuery} from '../test'

import {mockReporter} from './fixtures'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {global: {}, testSearchQuery: 'my search query'} as RunTestsCommandConfig

    const result = await getTestsFromSearchQuery(api as any, config, mockReporter)

    expect(result).toEqual([])
    expect(mockReporter.error).not.toHaveBeenCalled()
  })

  it('should log an error message if too many tests are returned by the search query', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: Array(101)}),
    }
    const config = {global: {}, testSearchQuery: 'my search query'} as RunTestsCommandConfig

    const result = await getTestsFromSearchQuery(api as any, config, mockReporter)

    expect(result).toEqual([])
    expect(mockReporter.error).toHaveBeenCalledWith(
      'More than 100 tests returned by search query, only the first 100 will be fetched.\n'
    )
  })
})
