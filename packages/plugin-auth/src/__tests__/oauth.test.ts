import {createHash} from 'node:crypto'

import {
  CALLBACK_PORTS,
  REQUIRED_SCOPE,
  buildAuthorizationUrl,
  createPKCE,
  getRedirectUri,
  normalizeScopes,
  resolveSite,
} from '../oauth'

describe('OAuth helpers', () => {
  test('generates a valid S256 PKCE pair', () => {
    const pkce = createPKCE()
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
    expect(pkce.challenge).not.toContain('=')
  })

  test('normalizes required and additional scopes', () => {
    expect(normalizeScopes([' z_scope ', REQUIRED_SCOPE, '', 'a_scope', 'z_scope'])).toEqual([
      'a_scope',
      REQUIRED_SCOPE,
      'z_scope',
    ])
  })

  test('resolves site using CLI, DATADOG_SITE, DD_SITE, then default', () => {
    expect(resolveSite('datadoghq.eu', {DATADOG_SITE: 'us3.datadoghq.com'})).toBe('datadoghq.eu')
    expect(resolveSite(undefined, {DATADOG_SITE: 'us3.datadoghq.com', DD_SITE: 'datadoghq.eu'})).toBe(
      'us3.datadoghq.com'
    )
    expect(resolveSite(undefined, {DD_SITE: 'datadoghq.eu'})).toBe('datadoghq.eu')
    expect(resolveSite(undefined, {})).toBe('datadoghq.com')
  })

  test('rejects custom hosts even when the generic validation bypass is set', () => {
    expect(() => resolveSite('example.com', {DD_CI_BYPASS_SITE_VALIDATION: '1'})).toThrow('Unsupported Datadog site')
  })

  test('builds a deterministic authorization URL', () => {
    const url = new URL(
      buildAuthorizationUrl({
        challenge: 'challenge',
        clientId: 'client',
        redirectUri: getRedirectUri(8000),
        scopes: ['a', 'b'],
        site: 'datadoghq.eu',
        state: 'state',
      })
    )
    expect(url.origin).toBe('https://app.datadoghq.eu')
    expect(url.pathname).toBe('/oauth2/v1/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      redirect_uri: 'http://localhost:8000/oauth/callback',
      response_type: 'code',
      scope: 'a b',
      state: 'state',
    })
  })

  test('keeps the supported callback port list stable for DCR', () => {
    expect(CALLBACK_PORTS.map(getRedirectUri)).toEqual([
      'http://localhost:8000/oauth/callback',
      'http://localhost:8080/oauth/callback',
      'http://localhost:8888/oauth/callback',
      'http://localhost:9000/oauth/callback',
    ])
  })
})
