import {getInvalidAllowedDomains, isAllowedHost} from '../../tunnel/allowed-domains'

describe('isAllowedHost', () => {
  test.each([
    ['example.com', ['example.com'], true],
    ['EXAMPLE.com.', ['example.com'], true],
    ['example.com', ['Example.COM.'], true],
    ['api.example.com', ['example.com'], false],
    ['api.example.com', ['*.example.com'], true],
    ['a.b.example.com', ['*.example.com'], true],
    ['example.com', ['*.example.com'], false],
    ['badexample.com', ['*.example.com'], false],
    ['example.com.evil.com', ['example.com', '*.example.com'], false],
    ['10.0.0.1', ['example.com'], false],
    ['10.0.0.1', ['10.0.0.1'], true],
    ['::1', ['[::1]'], true],
    ['127.0.0.1\u0000.example.com', ['*.example.com'], false],
    ['localhost\u0000.example.com', ['*.example.com'], false],
    [' example.com', ['example.com'], false],
    ['example.com:80', ['example.com'], false],
    ['vault.internal', ['example.com', '*.example.org'], false],
    ['example.com', [], false],
  ])('%s with %j is allowed: %s', (host, allowedDomains, expected) => {
    expect(isAllowedHost(host, allowedDomains)).toBe(expected)
  })
})

describe('getInvalidAllowedDomains', () => {
  test('accepts host names, wildcards and IP addresses', () => {
    expect(getInvalidAllowedDomains(['example.com', '*.example.com', '10.0.0.1', '[::1]', 'localhost'])).toEqual([])
  })

  test('rejects empty entries, URLs and misplaced wildcards', () => {
    expect(
      getInvalidAllowedDomains(['', ' ', '*', '*.', 'https://example.com', 'example.com/path', 'api.*.example.com'])
    ).toEqual(['', ' ', '*', '*.', 'https://example.com', 'example.com/path', 'api.*.example.com'])
  })
})
