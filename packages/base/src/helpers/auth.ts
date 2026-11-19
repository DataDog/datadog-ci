/**
 * Shared Datadog credential handling.
 *
 * - "Data upload" commands only need an API key (DD_API_KEY). With Workload Identity Federation (WIF),
 *   an intake mapping provides one.
 * - "Org action" commands act on behalf of a user or service account: they need an access token
 *   (DD_ACCESS_TOKEN, sent as `Authorization: Bearer`) from a WIF identity mapping, or an API key and an
 *   application key. An access token takes precedence over an application key.
 */

export const AUTHENTICATION_DOCS_URL = 'https://github.com/DataDog/datadog-ci#authentication'

export interface OrgCredentials {
  /** Bearer access token, for example from a WIF identity mapping. Takes precedence over `appKey`. */
  accessToken?: string
  apiKey?: string
  appKey?: string
}

/**
 * Read the access token from the environment, following the same `DATADOG_*` then `DD_*` order as the API and
 * application keys.
 */
export const getAccessTokenFromEnv = (env: NodeJS.ProcessEnv = process.env): string | undefined =>
  env.DATADOG_ACCESS_TOKEN || env.DD_ACCESS_TOKEN || undefined

/**
 * Normalize org-action credentials: empty values are dropped, and an access token wins over an application key,
 * so the application key is dropped when a token is set. The API key is kept when provided.
 */
export const resolveOrgCredentials = ({accessToken, apiKey, appKey}: OrgCredentials): OrgCredentials => {
  if (accessToken) {
    return {accessToken, apiKey: apiKey || undefined}
  }

  return {apiKey: apiKey || undefined, appKey: appKey || undefined}
}

export const hasOrgCredentials = (credentials: OrgCredentials): boolean =>
  !!credentials.accessToken || (!!credentials.apiKey && !!credentials.appKey)

/**
 * Explain which credentials an org-action command is missing, or return `undefined` when the credentials are enough:
 * an access token, or an API key and an application key.
 */
export const getMissingOrgCredentialsMessage = (commandName: string, credentials: OrgCredentials): string | undefined => {
  if (hasOrgCredentials(credentials)) {
    return undefined
  }

  const identityMappingHint =
    'With Workload Identity Federation, use an identity mapping to get an access token: an intake mapping only provides an API key.'

  if (credentials.apiKey) {
    return (
      `\`${commandName}\` needs an application key (DD_APP_KEY) or an access token (DD_ACCESS_TOKEN). ` +
      'An intake mapping only provides an API key: use a Workload Identity Federation identity mapping to get an access token. ' +
      `See ${AUTHENTICATION_DOCS_URL}`
    )
  }

  if (credentials.appKey) {
    return (
      `\`${commandName}\` needs an API key (DD_API_KEY) to go with the application key, or an access token (DD_ACCESS_TOKEN). ` +
      `${identityMappingHint} See ${AUTHENTICATION_DOCS_URL}`
    )
  }

  return (
    `\`${commandName}\` needs an access token (DD_ACCESS_TOKEN), or an API key (DD_API_KEY) and an application key (DD_APP_KEY). ` +
    `${identityMappingHint} See ${AUTHENTICATION_DOCS_URL}`
  )
}

/**
 * One-paragraph authentication notes appended to each command's `--help` details.
 * They all start with `Authentication:`.
 */
export const AUTH_HELP = {
  apiKey:
    'Authentication: this command needs a Datadog API key (DD_API_KEY). ' +
    'With Workload Identity Federation, an intake mapping provides it. ' +
    `See ${AUTHENTICATION_DOCS_URL}`,
  orgAction:
    'Authentication: this command needs an access token (DD_ACCESS_TOKEN) from a Workload Identity Federation identity mapping, ' +
    'or a Datadog API key (DD_API_KEY) and an application key (DD_APP_KEY). ' +
    'An access token takes precedence over an application key. An intake mapping alone is not enough. ' +
    `See ${AUTHENTICATION_DOCS_URL}`,
  none: 'Authentication: this command does not need Datadog credentials.',
} as const

/**
 * Authentication note for Serverless `instrument` commands, which store Datadog credentials in the instrumented service.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 * @param datadogCredentials - how the command reads the Datadog API key, for example "a Datadog API key (DD_API_KEY)".
 */
export const getServerlessInstrumentAuthHelp = (cloudCredentials: string, datadogCredentials: string): string =>
  `Authentication: this command uses your ${cloudCredentials} and ${datadogCredentials}, which is stored in the instrumented service ` +
  'so it can send telemetry. A short-lived key from a Workload Identity Federation intake mapping expires and is not suited for this. ' +
  `See ${AUTHENTICATION_DOCS_URL}`

/**
 * Authentication note for Serverless `uninstrument` commands.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 */
export const getServerlessUninstrumentAuthHelp = (cloudCredentials: string): string =>
  `Authentication: this command uses your ${cloudCredentials} and does not need Datadog credentials.`
