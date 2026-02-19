import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'

import {getCISpanTags} from '../../helpers/ci'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {
  CI_ENV_VARS,
  CI_JOB_ID,
  CI_JOB_NAME,
  CI_JOB_URL,
  CI_NODE_LABELS,
  CI_NODE_NAME,
  CI_PIPELINE_ID,
  CI_PIPELINE_NAME,
  CI_PIPELINE_NUMBER,
  CI_PIPELINE_URL,
  CI_PROVIDER_NAME,
  CI_STAGE_NAME,
  CI_WORKSPACE_PATH,
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_DATE,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_DATE,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_COMMIT_MESSAGE,
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH,
  GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  PR_NUMBER,
} from '../../helpers/tags'
import {getUserCISpanTags, getUserGitSpanTags} from '../../helpers/user-provided-git'

/**
 * Explicit mapping from internal tag keys to DD_* environment variable names.
 */
const TAG_TO_ENV_VAR: Record<string, string> = {
  // CI tags
  [CI_JOB_ID]: 'DD_CI_JOB_ID',
  [CI_JOB_NAME]: 'DD_CI_JOB_NAME',
  [CI_JOB_URL]: 'DD_CI_JOB_URL',
  [CI_NODE_LABELS]: 'DD_CI_NODE_LABELS',
  [CI_NODE_NAME]: 'DD_CI_NODE_NAME',
  [CI_PIPELINE_ID]: 'DD_CI_PIPELINE_ID',
  [CI_PIPELINE_NAME]: 'DD_CI_PIPELINE_NAME',
  [CI_PIPELINE_NUMBER]: 'DD_CI_PIPELINE_NUMBER',
  [CI_PIPELINE_URL]: 'DD_CI_PIPELINE_URL',
  [CI_PROVIDER_NAME]: 'DD_CI_PROVIDER_NAME',
  [CI_STAGE_NAME]: 'DD_CI_STAGE_NAME',
  [CI_WORKSPACE_PATH]: 'DD_CI_WORKSPACE_PATH',
  [CI_ENV_VARS]: 'DD_CI_ENV_VARS',

  // Git tags
  [GIT_BRANCH]: 'DD_GIT_BRANCH',
  [GIT_COMMIT_AUTHOR_DATE]: 'DD_GIT_COMMIT_AUTHOR_DATE',
  [GIT_COMMIT_AUTHOR_EMAIL]: 'DD_GIT_COMMIT_AUTHOR_EMAIL',
  [GIT_COMMIT_AUTHOR_NAME]: 'DD_GIT_COMMIT_AUTHOR_NAME',
  [GIT_COMMIT_COMMITTER_DATE]: 'DD_GIT_COMMIT_COMMITTER_DATE',
  [GIT_COMMIT_COMMITTER_EMAIL]: 'DD_GIT_COMMIT_COMMITTER_EMAIL',
  [GIT_COMMIT_COMMITTER_NAME]: 'DD_GIT_COMMIT_COMMITTER_NAME',
  [GIT_COMMIT_MESSAGE]: 'DD_GIT_COMMIT_MESSAGE',
  [GIT_HEAD_SHA]: 'DD_GIT_COMMIT_HEAD_SHA',
  [GIT_PULL_REQUEST_BASE_BRANCH]: 'DD_GIT_PULL_REQUEST_BASE_BRANCH',
  [GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA]: 'DD_GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA',
  [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: 'DD_GIT_PULL_REQUEST_BASE_BRANCH_SHA',
  [GIT_REPOSITORY_URL]: 'DD_GIT_REPOSITORY_URL',
  [GIT_SHA]: 'DD_GIT_COMMIT_SHA',
  [GIT_TAG]: 'DD_GIT_TAG',

  // PR tags
  [PR_NUMBER]: 'DD_PR_NUMBER',
}

/**
 * Converts a tag key to an environment variable name using explicit mapping.
 * Falls back to the tag key itself if no explicit mapping exists.
 */
const tagKeyToEnvVar = (tagKey: string): string => {
  return TAG_TO_ENV_VAR[tagKey] || tagKey
}

/**
 * Escapes a value for use in bash single-quoted strings.
 * Uses single quotes to avoid variable expansion and command injection.
 * Inside single quotes, nothing is interpreted by bash ($VAR, $(cmd), etc. stay literal).
 */
const escapeBashValue = (value: string): string => {
  // Replace single quotes with '\'' which ends the quote, adds an escaped quote, and starts a new quote
  return value.replace(/'/g, "'\\''")
}

/**
 * Escapes a value for use in double-quoted tag values.
 */
const escapeTagValue = (value: string): string => {
  // Escape backslashes first, then double quotes
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 *  Output for different formats.
 */
const formatOutput = (tags: Record<string, string>, format: 'bash' | 'json' | 'tags'): string => {
  const entries = Object.entries(tags).map(([key, value]) => {
    const envVarName = tagKeyToEnvVar(key)

    return {key, envVarName, value}
  })

  if (format === 'tags') {
    return entries
      .map(({key, value}) => {
        const escapedValue = escapeTagValue(value)

        return `${key}:"${escapedValue}"`
      })
      .join('\n')
  }

  if (format === 'json') {
    const jsonObj: Record<string, string> = {}
    for (const {envVarName, value} of entries) {
      jsonObj[envVarName] = value
    }

    return JSON.stringify(jsonObj, undefined, 2)
  }

  return entries
    .map(({envVarName, value}) => {
      const escapedValue = escapeBashValue(value)

      return `${envVarName}='${escapedValue}'`
    })
    .join('\n')
}

export class ReadCiEnvCommand extends BaseCommand {
  public static paths = [['ci-env', 'read']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Extract and normalize CI environment variables into DD_CI_* and DD_GIT_* format.',
    details: `
      This command reads CI-specific environment variables from various CI providers
      and outputs them as normalized DD_CI_* and DD_GIT_* environment variables.
      Supports bash (default), json, and tags output formats.
    `,
    examples: [
      ['Set variables in current shell', 'eval "$(datadog-ci ci-env read)"'],
      ['Save as .env file for Docker', 'datadog-ci ci-env read > .env'],
      ['Use with shell scripts', 'datadog-ci ci-env read > ci.env && source ci.env'],
      ['Get JSON output', 'datadog-ci ci-env read --format json'],
      ['Get Datadog tags format', 'datadog-ci ci-env read --format tags'],
    ],
  })

  private format = Option.String('--format', 'bash', {
    description: 'Output format: bash (default), json, or tags',
  })

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    // Merge CI-detected tags with user-provided tags (user-provided takes precedence)
    const ciTags = getCISpanTags()
    const userCITags = getUserCISpanTags()
    const userGitTags = getUserGitSpanTags()

    const tags = {
      ...ciTags,
      ...userCITags,
      ...userGitTags,
    }

    if (!tags || Object.keys(tags).length === 0) {
      this.context.stderr.write(
        'Warning: No CI environment detected or no CI tags found. ' +
          'This command should be run in a CI environment.\n'
      )

      return 1
    }

    const format = this.format.toLowerCase() as 'bash' | 'json' | 'tags'
    if (!['bash', 'json', 'tags'].includes(format)) {
      this.context.stderr.write(`Error: Invalid format '${this.format}'. Use: bash, json, or tags\n`)

      return 1
    }

    const output = formatOutput(tags, format)
    this.context.stdout.write(output + '\n')

    return 0
  }
}
