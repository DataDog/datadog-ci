import {client} from '@datadog/datadog-api-client'

// The api-client defaults to cross-fetch (node-fetch v2), which intermittently throws
// ERR_STREAM_PREMATURE_CLOSE against the Datadog API on some platforms (notably Alpine/musl).
// Node's native fetch (undici) handles connection close gracefully, so route the client through it.
export const createE2EConfiguration = (authMethods?: client.AuthMethodsConfiguration): client.Configuration =>
  client.createConfiguration({fetch: globalThis.fetch, ...(authMethods ? {authMethods} : {})})

// The api-client reads DD_API_KEY and DD_APP_KEY from the environment but not an access token, so pass it explicitly.
// `appKeyAuth: undefined` stops the api-client from adding DD_APP_KEY from the environment next to the token.
export const getE2EAuthMethods = (creds: {accessToken?: string; apiKey?: string; appKey?: string}) =>
  creds.accessToken
    ? {apiKeyAuth: creds.apiKey, appKeyAuth: undefined, AuthZ: {accessToken: creds.accessToken}}
    : {apiKeyAuth: creds.apiKey, appKeyAuth: creds.appKey}
