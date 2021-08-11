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
  | typeof GIT_COMMIT_AUTHOR_EMAIL
  | typeof GIT_COMMIT_AUTHOR_NAME
  | typeof GIT_COMMIT_AUTHOR_DATE
  | typeof GIT_COMMIT_MESSAGE
  | typeof GIT_COMMIT_COMMITTER_DATE
  | typeof GIT_COMMIT_COMMITTER_EMAIL
  | typeof GIT_COMMIT_COMMITTER_NAME

export type SpanTags = Partial<Record<SpanTag, string>>

// TODO deduplicate
export enum UploadStatus {
  Success,
  Failure,
  Skipped,
}
