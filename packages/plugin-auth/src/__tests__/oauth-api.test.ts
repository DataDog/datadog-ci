import {getProxyDispatcher, httpRequest} from '@datadog/datadog-ci-base/helpers/request'

import {
  CALLBACK_PORTS,
  exchangeAuthorizationCode,
  getCurrentUser,
  getRedirectUri,
  refreshAccessToken,
  registerClient,
} from '../oauth'

jest.mock('@datadog/datadog-ci-base/helpers/request', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/request'),
  getProxyDispatcher: jest.fn(() => 'proxy-dispatcher'),
  httpRequest: jest.fn(),
}))

const mockHttpRequest = httpRequest as jest.MockedFunction<typeof httpRequest>

describe('OAuth API', () => {
  afterEach(() => jest.resetAllMocks())

  test('registers a public client with every callback URL and an explicit custom port', async () => {
    mockHttpRequest.mockResolvedValue({data: {client_id: 'client'}} as any)
    await expect(registerClient('datadoghq.com', getRedirectUri(7777))).resolves.toBe('client')
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.datadoghq.com',
        data: {
          client_name: 'datadog-ci',
          grant_types: ['authorization_code', 'refresh_token'],
          redirect_uris: [...CALLBACK_PORTS.map(getRedirectUri), getRedirectUri(7777)],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        dispatcher: 'proxy-dispatcher',
        method: 'POST',
        url: '/api/v2/oauth2/register',
      })
    )
    expect(getProxyDispatcher).toHaveBeenCalled()
  })

  test('exchanges an authorization code using form encoding and PKCE', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {
        access_token: 'access',
        expires_in: 3600,
        refresh_token: 'refresh',
        scope: 'user_self_profile_read extra',
        token_type: 'Bearer',
      },
    } as any)
    await exchangeAuthorizationCode({
      clientId: 'client',
      code: 'code value',
      redirectUri: getRedirectUri(8000),
      site: 'datadoghq.com',
      verifier: 'verifier',
    })
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining('code=code+value'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        url: '/oauth2/v1/token',
      })
    )
    expect(mockHttpRequest.mock.calls[0][0].data).toContain('code_verifier=verifier')
  })

  test('keeps an existing refresh token when Datadog rotates only the access token', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {access_token: 'new', expires_in: 3600, scope: 'user_self_profile_read', token_type: 'Bearer'},
    } as any)
    await expect(
      refreshAccessToken({clientId: 'client', refreshToken: 'existing', site: 'datadoghq.eu'})
    ).resolves.toEqual(expect.objectContaining({accessToken: 'new', refreshToken: 'existing'}))
    expect(mockHttpRequest.mock.calls[0][0].data).toContain('grant_type=refresh_token')
  })

  test('validates the token with the current-user endpoint', async () => {
    mockHttpRequest.mockResolvedValue({
      data: {data: {attributes: {email: 'person@example.com', name: 'Person'}}},
    } as any)
    await expect(getCurrentUser('datadoghq.com', 'access-secret')).resolves.toEqual({
      email: 'person@example.com',
      name: 'Person',
    })
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({headers: {Authorization: 'Bearer access-secret'}, url: '/api/v2/users/me'})
    )
  })
})
