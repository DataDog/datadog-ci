import {getCommonAppBaseURL} from '../app'

describe('getCommonAppBaseUrl', () => {
  test('the base URL that is correct', () => {
    // Usual datadog site.
    expect(getCommonAppBaseURL('datadoghq.com', '')).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseURL('datadoghq.com', 'app')).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseURL('datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')

    // Other datadog site.
    expect(getCommonAppBaseURL('dd.datad0g.com', '')).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseURL('dd.datad0g.com', 'dd')).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseURL('dd.datad0g.com', 'myorg')).toBe('https://myorg.datad0g.com/')

    // Different top-level domain.
    expect(getCommonAppBaseURL('datadoghq.eu', '')).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseURL('datadoghq.eu', 'app')).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseURL('datadoghq.eu', 'myorg')).toBe('https://myorg.datadoghq.eu/')

    // AP1/US3/US5-type datadog site: the datadog site's subdomain is replaced by `subdomain` when `subdomain` is custom.
    // The correct Main DC (US3 in this case) is resolved automatically.
    expect(getCommonAppBaseURL('ap1.datadoghq.com', '')).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseURL('ap1.datadoghq.com', 'app')).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseURL('ap1.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', '')).toBe('https://ap2.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', 'app')).toBe('https://ap2.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', '')).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', 'app')).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', '')).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', 'app')).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
  })
})
