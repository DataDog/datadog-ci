import {isValidDatadogSite} from '../validation'

describe('validation', () => {
  test('isValidDatadogSite', () => {
    expect(isValidDatadogSite()).toBe(false)
    expect(isValidDatadogSite(undefined)).toBe(false)
    expect(isValidDatadogSite('')).toBe(false)
    expect(isValidDatadogSite('random')).toBe(false)
    expect(isValidDatadogSite('myorg.datadoghq.com')).toBe(false)
    expect(isValidDatadogSite('myorg.app.datadoghq.com')).toBe(false)
    expect(isValidDatadogSite('myorg.us3.datadoghq.com')).toBe(false)

    expect(isValidDatadogSite('datadoghq.com')).toBe(true)

    expect(isValidDatadogSite('ap1.datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('AP1.datadoghq.com')).toBe(true)

    expect(isValidDatadogSite('ap2.datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('AP2.datadoghq.com')).toBe(true)

    expect(isValidDatadogSite('us3.datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('US3.datadoghq.com')).toBe(true)

    expect(isValidDatadogSite('us5.datadoghq.com')).toBe(true)
    expect(isValidDatadogSite('US5.datadoghq.com')).toBe(true)

    process.env.DD_CI_BYPASS_SITE_VALIDATION = 'true'

    expect(isValidDatadogSite('')).toBe(true)
    expect(isValidDatadogSite('random')).toBe(true)
  })
})
