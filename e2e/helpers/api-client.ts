import {client} from '@datadog/datadog-api-client'

// The api-client defaults to cross-fetch (node-fetch v2), which intermittently throws
// ERR_STREAM_PREMATURE_CLOSE against the Datadog API on some platforms (notably Alpine/musl).
// Node's native fetch (undici) handles connection close gracefully, so route the client through it.
export const createE2EConfiguration = (authMethods?: client.AuthMethodsConfiguration): client.Configuration =>
  client.createConfiguration({fetch: globalThis.fetch, ...(authMethods ? {authMethods} : {})})
