import {getCommonAppBaseUrl} from '../app'

describe('getCommonAppBaseUrl', () => {
  test('the base URL that is correct', () => {
    // Usual datadog site.
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.com', subdomain: ''})).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.com', subdomain: 'app'})).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.com', subdomain: 'myorg'})).toBe('https://myorg.datadoghq.com/')

    // Other datadog site.
    expect(getCommonAppBaseUrl({datadogSite: 'dd.datad0g.com', subdomain: ''})).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'dd.datad0g.com', subdomain: 'dd'})).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'dd.datad0g.com', subdomain: 'myorg'})).toBe('https://myorg.datad0g.com/')

    // Different top-level domain.
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.eu', subdomain: ''})).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.eu', subdomain: 'app'})).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseUrl({datadogSite: 'datadoghq.eu', subdomain: 'myorg'})).toBe('https://myorg.datadoghq.eu/')

    // AP1/US3/US5-type datadog site: the datadog site's subdomain is replaced by `subdomain` when `subdomain` is custom.
    // The correct Main DC (US3 in this case) is resolved automatically.
    expect(getCommonAppBaseUrl({datadogSite: 'ap1.datadoghq.com', subdomain: ''})).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'ap1.datadoghq.com', subdomain: 'app'})).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'ap1.datadoghq.com', subdomain: 'myorg'})).toBe(
      'https://myorg.datadoghq.com/'
    )
    expect(getCommonAppBaseUrl({datadogSite: 'us3.datadoghq.com', subdomain: ''})).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'us3.datadoghq.com', subdomain: 'app'})).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'us3.datadoghq.com', subdomain: 'myorg'})).toBe(
      'https://myorg.datadoghq.com/'
    )
    expect(getCommonAppBaseUrl({datadogSite: 'us5.datadoghq.com', subdomain: ''})).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'us5.datadoghq.com', subdomain: 'app'})).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseUrl({datadogSite: 'us5.datadoghq.com', subdomain: 'myorg'})).toBe(
      'https://myorg.datadoghq.com/'
    )
  })
})
