import {DATADOG_ROUTE_PATHS, datadogRoute} from '../datadog-route'

describe('datadog-route', () => {
  test('returns the provided route unchanged', () => {
    expect(datadogRoute('/api/v2/srcmap')).toBe('/api/v2/srcmap')
  })

  test('exposes a unique list of statically-known Datadog routes', () => {
    expect(new Set(DATADOG_ROUTE_PATHS).size).toBe(DATADOG_ROUTE_PATHS.length)
  })

  test('formats parameterized routes', () => {
    expect(
      datadogRoute('/synthetics/tests/:testId/version_history/:version?only_check_existence=true', {
        testId: 'abc-def-ghi',
        version: 42,
      })
    ).toBe('/synthetics/tests/abc-def-ghi/version_history/42?only_check_existence=true')
  })

  test('requires params for parameterized routes at compile time', () => {
    // @ts-expect-error parameterized routes must provide replacement values
    datadogRoute('/synthetics/tests/:testId')

    expect(true).toBe(true)
  })
})
