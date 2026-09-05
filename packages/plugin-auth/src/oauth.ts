import {createHash, randomBytes} from 'node:crypto'

import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import {getApiUrl} from '@datadog/datadog-ci-base/helpers/api'
import {getCommonAppBaseURL} from '@datadog/datadog-ci-base/helpers/app'
import {getProxyDispatcher, httpRequest} from '@datadog/datadog-ci-base/helpers/request'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'

export const CALLBACK_PATH = '/oauth/callback'
export const CALLBACK_PORTS = [8000, 8080, 8888, 9000]
export const REQUIRED_SCOPE = 'user_self_profile_read'

export interface OAuthTokens {
  accessToken: string
  expiresIn: number
  refreshToken: string
  scope: string[]
  tokenType: string
}

interface DCRResponse {
  client_id: string
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
}

export const resolveSite = (site?: string, env: NodeJS.ProcessEnv = process.env): string => {
  const resolved = (site || env.DATADOG_SITE || env.DD_SITE || 'datadoghq.com').trim().toLowerCase()
  if (!DATADOG_SITES.includes(resolved)) {
    throw new Error(
      `Unsupported Datadog site ${JSON.stringify(resolved)}. Expected one of: ${DATADOG_SITES.join(', ')}`
    )
  }

  return resolved
}

export const normalizeScopes = (scopes: string[] = []): string[] =>
  [...new Set([REQUIRED_SCOPE, ...scopes.map((scope) => scope.trim()).filter(Boolean)])].sort()

export const createPKCE = () => {
  const verifier = randomBytes(48).toString('base64url')

  return {
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    verifier,
  }
}

export const createState = () => randomBytes(32).toString('base64url')

export const getRedirectUri = (port: number) => `http://localhost:${port}${CALLBACK_PATH}`

export const buildAuthorizationUrl = (input: {
  challenge: string
  clientId: string
  redirectUri: string
  scopes: string[]
  site: string
  state: string
}): string => {
  const url = new URL('oauth2/v1/authorize', getCommonAppBaseURL(input.site, 'app'))
  url.search = new URLSearchParams({
    client_id: input.clientId,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scopes.join(' '),
    state: input.state,
  }).toString()

  return url.toString()
}

export const registerClient = async (site: string, selectedRedirectUri?: string): Promise<string> => {
  const redirectUris = [
    ...CALLBACK_PORTS.map(getRedirectUri),
    ...(selectedRedirectUri ? [selectedRedirectUri] : []),
  ].filter((value, index, values) => values.indexOf(value) === index)
  const response = await httpRequest<DCRResponse>({
    baseURL: getApiUrl(site),
    data: {
      client_name: 'datadog-ci',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: redirectUris,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    dispatcher: getProxyDispatcher(),
    method: 'POST',
    url: datadogRoute('/api/v2/oauth2/register'),
  })

  if (!response.data.client_id) {
    throw new Error('Datadog did not return an OAuth client ID')
  }

  return response.data.client_id
}

const tokenRequest = async (site: string, params: URLSearchParams): Promise<TokenResponse> => {
  const response = await httpRequest<TokenResponse>({
    baseURL: getApiUrl(site),
    data: params.toString(),
    dispatcher: getProxyDispatcher(),
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    method: 'POST',
    url: datadogRoute('/oauth2/v1/token'),
  })

  return response.data
}

const normalizeTokens = (tokens: TokenResponse, previousRefreshToken?: string): OAuthTokens => {
  const refreshToken = tokens.refresh_token || previousRefreshToken
  if (!tokens.access_token || !refreshToken || !tokens.expires_in || !tokens.token_type) {
    throw new Error('Datadog returned an incomplete OAuth token response')
  }

  return {
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
    refreshToken,
    scope: normalizeScopes((tokens.scope || '').split(' ')),
    tokenType: tokens.token_type,
  }
}

export const exchangeAuthorizationCode = async (input: {
  clientId: string
  code: string
  redirectUri: string
  site: string
  verifier: string
}): Promise<OAuthTokens> =>
  normalizeTokens(
    await tokenRequest(
      input.site,
      new URLSearchParams({
        client_id: input.clientId,
        code: input.code,
        code_verifier: input.verifier,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri,
      })
    )
  )

export const refreshAccessToken = async (input: {
  clientId: string
  refreshToken: string
  site: string
}): Promise<OAuthTokens> =>
  normalizeTokens(
    await tokenRequest(
      input.site,
      new URLSearchParams({
        client_id: input.clientId,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      })
    ),
    input.refreshToken
  )

export const getCurrentUser = async (site: string, accessToken: string): Promise<{email?: string; name?: string}> => {
  const response = await httpRequest<any>({
    baseURL: getApiUrl(site),
    dispatcher: getProxyDispatcher(),
    headers: {Authorization: `Bearer ${accessToken}`},
    url: datadogRoute('/api/v2/users/me'),
  })
  const attributes = response.data?.data?.attributes || response.data?.attributes || {}

  return {email: attributes.email, name: attributes.name}
}
