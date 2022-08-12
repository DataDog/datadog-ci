// Build
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

// General
export const SPAN_TYPE = 'span.type'

/**
 * Receives an array of the form ['key:value', 'key2:value2']
 * and returns an object of the form {key: 'value', key2: 'value2'}
 */
export const parseTags = (tags: string[]) => {
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
