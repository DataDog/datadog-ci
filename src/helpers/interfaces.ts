import {
  CI_JOB_ID,
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
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
} from './tags'

export interface Metadata {
  ci: {
    pipeline: {
      url?: string
    }
    provider: {
      name: string
    }
  }
  git: {
    branch?: string
    commitSha?: string
  }
}

export type SpanTag =
  | typeof CI_JOB_ID
  | typeof CI_JOB_NAME
  | typeof CI_JOB_URL
  | typeof CI_PIPELINE_ID
  | typeof CI_PIPELINE_NAME
  | typeof CI_PIPELINE_NUMBER
  | typeof CI_PIPELINE_URL
  | typeof CI_PROVIDER_NAME
  | typeof CI_STAGE_NAME
  | typeof CI_WORKSPACE_PATH
  | typeof GIT_BRANCH
  | typeof GIT_REPOSITORY_URL
  | typeof GIT_SHA
  | typeof GIT_TAG

export type SpanTags = Partial<Record<SpanTag, string>>
