import {client} from '@datadog/datadog-api-client'

// The api-client defaults to cross-fetch (node-fetch v2), which intermittently throws
// ERR_STREAM_PREMATURE_CLOSE against the Datadog API on some platforms (notably Alpine/musl).
// Node's native fetch (undici) handles connection close gracefully, so route the client through it.
export const createE2EConfiguration = (authMethods?: client.AuthMethodsConfiguration): client.Configuration =>
  client.createConfiguration({fetch: globalThis.fetch, ...(authMethods ? {authMethods} : {})})

interface E2ECredentials {
  accessToken?: string
  apiKey?: string
  appKey?: string
}

/**
 * Auth methods for the read-back checks, matching datadog-ci's own precedence: an access token (for example from a
 * Workload Identity Federation identity mapping, sent as `Authorization: Bearer`) replaces the application key, and the
 * API key is still sent when set.
 * `appKeyAuth` is always set explicitly so the api-client does not fall back to `DD_APP_KEY` from the environment.
 */
export const getE2EAuthMethods = ({accessToken, apiKey, appKey}: E2ECredentials): client.AuthMethodsConfiguration =>
  accessToken
    ? {apiKeyAuth: apiKey || undefined, appKeyAuth: undefined, AuthZ: {accessToken}}
    : {apiKeyAuth: apiKey || undefined, appKeyAuth: appKey || undefined}
