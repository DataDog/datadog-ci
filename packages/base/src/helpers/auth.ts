import type {CommandClass} from 'clipanion'

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
export const getMissingOrgCredentialsMessage = (
  commandName: string,
  credentials: OrgCredentials
): string | undefined => {
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
 * Authentication note for commands that only call the cloud provider, such as Serverless `uninstrument` commands.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 */
export const getCloudCredentialsOnlyAuthHelp = (cloudCredentials: string): string =>
  `Authentication: this command uses your ${cloudCredentials} and does not need Datadog credentials.`

/**
 * Authentication note for commands that read from the cloud provider and send data to Datadog, such as flares.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 */
export const getCloudApiKeyAuthHelp = (cloudCredentials: string): string =>
  `Authentication: this command uses your ${cloudCredentials} and needs a Datadog API key (DD_API_KEY). ` +
  'With Workload Identity Federation, an intake mapping provides it. ' +
  `See ${AUTHENTICATION_DOCS_URL}`

export type AuthRequirement =
  | {kind: 'orgAction' | 'apiKey' | 'none'}
  /** Serverless and cloud-provider commands: the text names the cloud credentials and Datadog variables they read. */
  | {kind: 'serverless'; help: string}

const orgAction: AuthRequirement = {kind: 'orgAction'}
const apiKeyOnly: AuthRequirement = {kind: 'apiKey'}
const none: AuthRequirement = {kind: 'none'}
const serverless = (help: string): AuthRequirement => ({kind: 'serverless', help})

/**
 * The authentication requirement of every datadog-ci command, keyed by its first command path.
 * A test checks that every registered command has an entry.
 */
export const AUTH_REQUIREMENTS: Record<string, AuthRequirement> = {
  'aas instrument': serverless(getServerlessInstrumentAuthHelp('Azure credentials', 'a Datadog API key (DD_API_KEY)')),
  'aas uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('Azure credentials')),
  'ci-env read': none,
  'cloud-run flare': serverless(getCloudApiKeyAuthHelp('Google Cloud credentials')),
  'cloud-run instrument': serverless(
    getServerlessInstrumentAuthHelp('Google Cloud credentials', 'a Datadog API key (DD_API_KEY)')
  ),
  'cloud-run uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('Google Cloud credentials')),
  'container-app instrument': serverless(
    getServerlessInstrumentAuthHelp('Azure credentials', 'a Datadog API key (DD_API_KEY)')
  ),
  'container-app uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('Azure credentials')),
  'coverage upload': apiKeyOnly,
  'deployment correlate': apiKeyOnly,
  'deployment correlate-image': orgAction,
  'deployment gate': orgAction,
  'deployment mark': apiKeyOnly,
  'dora deployment': apiKeyOnly,
  'dsyms upload': apiKeyOnly,
  'ecs-fargate instrument': serverless(
    getServerlessInstrumentAuthHelp(
      'AWS credentials',
      'a Datadog API key (DD_API_KEY, or a secret passed with --api-key-secret-arn)'
    )
  ),
  'ecs-fargate uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('AWS credentials')),
  'elf-symbols upload': apiKeyOnly,
  'flutter-symbols upload': apiKeyOnly,
  'gate evaluate': orgAction,
  'git-metadata upload': apiKeyOnly,
  'junit upload': apiKeyOnly,
  'lambda cloudwatch': serverless(getCloudCredentialsOnlyAuthHelp('AWS credentials')),
  'lambda flare': serverless(getCloudApiKeyAuthHelp('AWS credentials')),
  'lambda instrument': serverless(
    getServerlessInstrumentAuthHelp(
      'AWS credentials',
      'a Datadog API key (DATADOG_API_KEY or DD_API_KEY, or DATADOG_KMS_API_KEY or DATADOG_API_KEY_SECRET_ARN)'
    )
  ),
  'lambda uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('AWS credentials')),
  measure: apiKeyOnly,
  'pe-symbols upload': apiKeyOnly,
  'plugin check': none,
  'plugin install': none,
  'plugin list': none,
  'ppdb-symbols upload': apiKeyOnly,
  'react-native codepush': apiKeyOnly,
  'react-native inject-debug-id': none,
  'react-native upload': apiKeyOnly,
  'react-native xcode': apiKeyOnly,
  'sarif upload': apiKeyOnly,
  'sbom upload': orgAction,
  'sourcemaps find': none,
  'sourcemaps inject': none,
  'sourcemaps upload': apiKeyOnly,
  'stepfunctions instrument': serverless(getCloudCredentialsOnlyAuthHelp('AWS credentials')),
  'stepfunctions uninstrument': serverless(getCloudCredentialsOnlyAuthHelp('AWS credentials')),
  'synthetics deploy-tests': orgAction,
  'synthetics import-tests': orgAction,
  'synthetics run-tests': orgAction,
  'synthetics upload-application': orgAction,
  tag: apiKeyOnly,
  'terraform upload': apiKeyOnly,
  trace: apiKeyOnly,
  'trace span': apiKeyOnly,
  'unity-symbols upload': apiKeyOnly,
  version: none,
  'wasm-sourcemaps upload': apiKeyOnly,
  'wasm-symbols upload': apiKeyOnly,
}

export const getAuthHelp = (requirement: AuthRequirement): string =>
  requirement.kind === 'serverless' ? requirement.help : AUTH_HELP[requirement.kind]

/**
 * Append a paragraph to Clipanion `details`, indented like the existing text so Clipanion's dedent renders it the same
 * way as if it had been written inline.
 */
const appendParagraph = (details: string | undefined, paragraph: string): string => {
  if (!details?.trim()) {
    return paragraph
  }

  const indents = details
    .split('\n')
    .filter((line) => /\S/.test(line))
    .map((line) => line.length - line.trimStart().length)
  const indent = ' '.repeat(Math.min(...indents))

  return `${details}\n\n${indent}${paragraph}\n`
}

/**
 * Append the command's "Authentication:" paragraph (from `AUTH_REQUIREMENTS`) to its `--help` details.
 * Commands without an entry are left unchanged. Calling it again on the same command does nothing.
 */
export const withAuthHelp = <T extends CommandClass<any>>(commandClass: T): T => {
  const path = commandClass.paths?.[0]?.join(' ')
  const requirement = path !== undefined ? AUTH_REQUIREMENTS[path] : undefined
  if (!requirement) {
    return commandClass
  }

  const paragraph = getAuthHelp(requirement)
  const usage = commandClass.usage ?? {}
  if (!usage.details?.includes(paragraph)) {
    commandClass.usage = {...usage, details: appendParagraph(usage.details, paragraph)}
  }

  return commandClass
}
