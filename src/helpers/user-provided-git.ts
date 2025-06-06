import {
  CI_JOB_NAME,
  CI_JOB_URL,
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
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  PR_NUMBER,
} from './tags'
import {normalizeRef, removeEmptyValues, filterSensitiveInfoFromRepository} from './utils'

export const getUserGitSpanTags = () => {
  const {
    DD_GIT_REPOSITORY_URL,
    DD_GIT_COMMIT_SHA,
    DD_GIT_BRANCH,
    DD_GIT_TAG,
    DD_GIT_COMMIT_MESSAGE,
    DD_GIT_COMMIT_AUTHOR_NAME,
    DD_GIT_COMMIT_AUTHOR_EMAIL,
    DD_GIT_COMMIT_AUTHOR_DATE,
    DD_GIT_COMMIT_COMMITTER_NAME,
    DD_GIT_COMMIT_COMMITTER_EMAIL,
    DD_GIT_COMMIT_COMMITTER_DATE,
    DD_GIT_PULL_REQUEST_BASE_BRANCH,
    DD_GIT_PULL_REQUEST_BASE_BRANCH_SHA,
    DD_GIT_COMMIT_HEAD_SHA,
    DD_PR_NUMBER,
  } = process.env

  let branch = normalizeRef(DD_GIT_BRANCH)
  let tag = normalizeRef(DD_GIT_TAG)

  if (DD_GIT_BRANCH?.includes('origin/tags') || DD_GIT_BRANCH?.includes('refs/heads/tags')) {
    branch = undefined
    tag = normalizeRef(DD_GIT_BRANCH)
  }

  return removeEmptyValues({
    [GIT_REPOSITORY_URL]: filterSensitiveInfoFromRepository(DD_GIT_REPOSITORY_URL),
    [GIT_BRANCH]: branch,
    [GIT_SHA]: DD_GIT_COMMIT_SHA,
    [GIT_TAG]: tag,
    [GIT_COMMIT_MESSAGE]: DD_GIT_COMMIT_MESSAGE,
    [GIT_COMMIT_COMMITTER_DATE]: DD_GIT_COMMIT_COMMITTER_DATE,
    [GIT_COMMIT_COMMITTER_EMAIL]: DD_GIT_COMMIT_COMMITTER_EMAIL,
    [GIT_COMMIT_COMMITTER_NAME]: DD_GIT_COMMIT_COMMITTER_NAME,
    [GIT_COMMIT_AUTHOR_DATE]: DD_GIT_COMMIT_AUTHOR_DATE,
    [GIT_COMMIT_AUTHOR_EMAIL]: DD_GIT_COMMIT_AUTHOR_EMAIL,
    [GIT_COMMIT_AUTHOR_NAME]: DD_GIT_COMMIT_AUTHOR_NAME,
    [GIT_PULL_REQUEST_BASE_BRANCH]: DD_GIT_PULL_REQUEST_BASE_BRANCH,
    [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: DD_GIT_PULL_REQUEST_BASE_BRANCH_SHA,
    [GIT_HEAD_SHA]: DD_GIT_COMMIT_HEAD_SHA,
    [PR_NUMBER]: DD_PR_NUMBER,
  })
}

export const getUserCISpanTags = () => {
  const {
    DD_CI_JOB_NAME,
    DD_CI_JOB_URL,
    DD_CI_PIPELINE_ID,
    DD_CI_PIPELINE_NAME,
    DD_CI_PIPELINE_NUMBER,
    DD_CI_PIPELINE_URL,
    DD_CI_PROVIDER_NAME,
    DD_CI_STAGE_NAME,
    DD_CI_WORKSPACE_PATH,
  } = process.env

  return removeEmptyValues({
    [CI_JOB_NAME]: DD_CI_JOB_NAME,
    [CI_JOB_URL]: DD_CI_JOB_URL,
    [CI_PIPELINE_ID]: DD_CI_PIPELINE_ID,
    [CI_PIPELINE_NAME]: DD_CI_PIPELINE_NAME,
    [CI_PIPELINE_NUMBER]: DD_CI_PIPELINE_NUMBER,
    [CI_PIPELINE_URL]: DD_CI_PIPELINE_URL,
    [CI_PROVIDER_NAME]: DD_CI_PROVIDER_NAME,
    [CI_STAGE_NAME]: DD_CI_STAGE_NAME,
    [CI_WORKSPACE_PATH]: DD_CI_WORKSPACE_PATH,
  })
}
