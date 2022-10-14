import {isValidDatadogSite} from '../validation'

describe('validation', () => {
  test('isValidDatadogSite', () => {
    expect(isValidDatadogSite('')).toBe(false)
    expect(isValidDatadogSite('random')).toBe(false)
    expect(isValidDatadogSite('myorg.app.datadoghq.com')).toBe(false)
    expect(isValidDatadogSite('myorg.us3.datadoghq.com')).toBe(false)

    expect(isValidDatadogSite('datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('us3.datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('US3.datadoghq.com')).toBe(true)
  })
})
