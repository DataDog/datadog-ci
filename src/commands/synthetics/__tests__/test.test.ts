import {getTestsFromSearchQuery} from '../test'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if an empty string is given', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
    const config = {global: {}, defaultTestOverrides: {}, testSearchQuery: ''}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })

  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
    const config = {global: {}, defaultTestOverrides: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })
})
