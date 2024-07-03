// Build
import {getCISpanTags} from './ci'
import {DatadogCiConfig} from './config'
import {getGitMetadata} from './git/format-git-span-data'
import {SpanTags} from './interfaces'
import {getUserGitSpanTags} from './user-provided-git'

export const CI_PIPELINE_URL = 'ci.pipeline.url'
export const CI_PROVIDER_NAME = 'ci.provider.name'
export const CI_PIPELINE_ID = 'ci.pipeline.id'
export const CI_PIPELINE_NAME = 'ci.pipeline.name'
export const CI_PIPELINE_NUMBER = 'ci.pipeline.number'
export const CI_WORKSPACE_PATH = 'ci.workspace_path'
export const GIT_REPOSITORY_URL = 'git.repository_url'
export const CI_JOB_URL = 'ci.job.url'
export const CI_JOB_NAME = 'ci.job.name'
export const CI_STAGE_NAME = 'ci.stage.name'
export const CI_LEVEL = '_dd.ci.level'
// @deprecated TODO: remove this once backend is updated
export const CI_BUILD_LEVEL = '_dd.ci.build_level'

export const CI_ENV_VARS = '_dd.ci.env_vars'
export const CI_NODE_NAME = 'ci.node.name'
export const CI_NODE_LABELS = 'ci.node.labels'

// Git
export const GIT_BRANCH = 'git.branch'
export const GIT_COMMIT_AUTHOR_DATE = 'git.commit.author.date'
export const GIT_COMMIT_AUTHOR_EMAIL = 'git.commit.author.email'
export const GIT_COMMIT_AUTHOR_NAME = 'git.commit.author.name'
export const GIT_COMMIT_COMMITTER_DATE = 'git.commit.committer.date'
export const GIT_COMMIT_COMMITTER_EMAIL = 'git.commit.committer.email'
export const GIT_COMMIT_COMMITTER_NAME = 'git.commit.committer.name'
export const GIT_COMMIT_MESSAGE = 'git.commit.message'
export const GIT_SHA = 'git.commit.sha'
export const GIT_TAG = 'git.tag'
export const GIT_HEAD_SHA = 'git.commit.head_sha'
export const GIT_BASE_REF = 'git.commit.base_ref'

// General
export const SPAN_TYPE = 'span.type'
export const SERVICE = 'service'

const parseNumericTag = (numericTag: string | undefined): number | undefined => {
  if (numericTag) {
    const number = parseFloat(numericTag)

    return isFinite(number) ? number : undefined
  }
}

/**
 * Receives an array of the form ['key:value', 'key2:value2']
 * and returns an object of the form {key: 'value', key2: 'value2'}
 */
export const parseTags = (tags: string[]): Record<string, string> => {
  try {
    return tags.reduce((acc, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }
      const firstColon = keyValuePair.indexOf(':')

      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      return {
        ...acc,
        [key]: value,
      }
    }, {})
  } catch (e) {
    return {}
  }
}

/**
 * Similar to `parseTags` but it's assumed that numbers are received
 * Receives an array of the form ['key:123', 'key2:321']
 * and returns an object of the form {key: 123, key2: 321}
 */
export const parseMetrics = (tags: string[]) => {
  try {
    return tags.reduce((acc, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }
      const firstColon = keyValuePair.indexOf(':')

      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      const number = parseNumericTag(value)

      if (number !== undefined) {
        return {
          ...acc,
          [key]: number,
        }
      }

      return acc
    }, {})
  } catch (e) {
    return {}
  }
}

/**
 * The repository URL is mandatory in processing for the following commands: sarif and sbom.
 * Note: for sarif uploads, this will fail silent on the backend.
 */
export const mandatoryGitFields: Record<string, boolean> = {
  [GIT_REPOSITORY_URL]: true,
}

/**
 * Get the tags to upload results in CI for the following commands: sarif and sbom.
 * @param config - the configuration of the CLI
 * @param additionalTags - additional tags passed, generally from the command line.
 */
export const getSpanTags = async (config: DatadogCiConfig, additionalTags: string[] | undefined): Promise<SpanTags> => {
  const ciSpanTags = getCISpanTags()
  const gitSpanTags = await getGitMetadata()
  const userGitSpanTags = getUserGitSpanTags()

  const envVarTags = config.envVarTags ? parseTags(config.envVarTags.split(',')) : {}
  const cliTags = additionalTags ? parseTags(additionalTags) : {}

  return {
    ...gitSpanTags,
    ...ciSpanTags,
    ...userGitSpanTags, // User-provided git tags have precedence over the ones we get from the git command
    ...cliTags,
    ...envVarTags,
    ...(config.env ? {env: config.env} : {}),
  }
}
