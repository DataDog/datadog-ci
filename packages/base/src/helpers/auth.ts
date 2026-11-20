import {stripVTControlCharacters} from 'util'

import type {BaseContext, CommandClass} from 'clipanion'

import {Cli, Command} from 'clipanion'

import {makeTerminalLink} from './terminal-link'

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

export const WORKLOAD_IDENTITY_FEDERATION_DOCS_URL =
  'https://docs.datadoghq.com/account_management/workload_identity_federation/'

const wif = makeTerminalLink(WORKLOAD_IDENTITY_FEDERATION_DOCS_URL)`Workload Identity Federation`
const seeReadme = `See\n${AUTHENTICATION_DOCS_URL}`

/**
 * Bodies of the "Authentication" section of `--help`. Paragraphs are separated by a blank line, and a single newline is
 * a hard line break.
 */
export const AUTH_HELP = {
  apiKey:
    'This command sends telemetry to your org. ' +
    `As such, it requires an API key (DD_API_KEY), which a ${wif} intake mapping can provide.\n\n${seeReadme}`,
  orgAction:
    'This command calls Datadog API endpoints. ' +
    'As such, it requires either an API key (DD_API_KEY) and an application key (DD_APP_KEY), ' +
    `or an access token (DD_ACCESS_TOKEN) from a ${wif} identity mapping.\n\n${seeReadme}`,
  none: `This command does not need Datadog credentials.\n\n${seeReadme}`,
}

/**
 * Authentication help for Serverless `instrument` commands, which save the Datadog API key in the instrumented service.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 * @param datadogCredentials - how the command reads the Datadog API key, for example "a Datadog API key (DD_API_KEY)".
 */
export const getServerlessInstrumentAuthHelp = (cloudCredentials: string, datadogCredentials: string): string =>
  `This command uses your ${cloudCredentials} and saves ${datadogCredentials} in the instrumented service, ` +
  'which uses it to send telemetry. ' +
  `As such, it requires a long-lived API key: a short-lived key from a ${wif} intake mapping would expire.\n\n${seeReadme}`

/**
 * Authentication help for commands that only call the cloud provider, such as Serverless `uninstrument` commands.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 */
export const getCloudCredentialsOnlyAuthHelp = (cloudCredentials: string): string =>
  `This command uses your ${cloudCredentials}. It does not need Datadog credentials.\n\n${seeReadme}`

/**
 * Authentication help for the Serverless `flare` commands, which read from the cloud provider and send a flare to Datadog.
 * @param cloudCredentials - the cloud provider credentials the command uses, for example "AWS credentials".
 */
export const getFlareAuthHelp = (cloudCredentials: string): string =>
  `This command uses your ${cloudCredentials} and sends a flare to Datadog support. ` +
  `As such, it requires an API key (DD_API_KEY), which a ${wif} intake mapping can provide.\n\n${seeReadme}`

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
  'cloud-run flare': serverless(getFlareAuthHelp('Google Cloud credentials')),
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
  'lambda flare': serverless(getFlareAuthHelp('AWS credentials')),
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
 * The authentication help of a command, from `AUTH_REQUIREMENTS` and its first command path.
 */
export const getAuthHelpForCommand = (commandClass: CommandClass<any>): string | undefined => {
  const path = commandClass.paths?.[0]?.join(' ')
  const requirement = path !== undefined ? AUTH_REQUIREMENTS[path] : undefined

  return requirement ? getAuthHelp(requirement) : undefined
}

const HELP_WIDTH = 80
// A terminal hyperlink (OSC 8) is one unbreakable word, so its escape sequence never gets split.
const WORD_REGEX = /\u001B\]8;;[^\u0007]*\u0007[^\u001B]*\u001B\]8;;\u0007\S*|\S+/g

/** Wrap a line at 80 visible characters, like Clipanion does for `Details`, without splitting terminal links. */
const wrapLine = (line: string): string => {
  const lines: string[] = []
  let current = ''
  for (const word of line.match(WORD_REGEX) ?? []) {
    const candidate = current ? `${current} ${word}` : word
    if (current && stripVTControlCharacters(candidate).length > HELP_WIDTH) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  lines.push(current)

  return lines.join('\n')
}

/** Format an authentication help text: paragraphs separated by a blank line, single newlines kept as line breaks. */
export const formatAuthHelp = (text: string): string =>
  `${text
    .split('\n\n')
    .map((paragraph) => paragraph.split('\n').map(wrapLine).join('\n'))
    .join('\n\n')}\n`

/**
 * A Clipanion `Cli` whose detailed `--help` has an "Authentication" section, after "Details" and before "Examples",
 * for every command with an `AUTH_REQUIREMENTS` entry. The section is rendered with Clipanion's own header style.
 *
 * Every help route goes through `Cli.usage()`: `<command> --help` and `-h` (through the builtin `HelpCommand`) and
 * `Cli.run` for a command with `help` set. The command's `usage.details` is left unchanged.
 */
export class CliWithAuthHelp<Context extends BaseContext = BaseContext> extends Cli<Context> {
  public usage(
    // Same signature as `Cli.usage()`, where `null` means the general usage.
    // eslint-disable-next-line no-null/no-null
    command: CommandClass<Context> | Command<Context> | null = null,
    opts: {colored?: boolean; detailed?: boolean; prefix?: string} = {}
  ): string {
    const result = super.usage(command, opts)
    const commandClass = command instanceof Command ? (command.constructor as CommandClass<Context>) : command
    const help = opts.detailed && commandClass ? getAuthHelpForCommand(commandClass) : undefined
    if (!help) {
      return result
    }

    const format = this.format(opts.colored)
    const section = `\n${format.header('Authentication')}\n\n${formatAuthHelp(help)}`
    const examplesIndex = result.indexOf(`\n${format.header('Examples')}\n`)

    return examplesIndex === -1
      ? `${result}${section}`
      : `${result.slice(0, examplesIndex)}${section}${result.slice(examplesIndex)}`
  }
}
