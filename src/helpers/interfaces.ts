import type {Writable} from 'stream'

import {AxiosPromise, AxiosRequestConfig} from 'axios'

import {
  CI_ENV_VARS,
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
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  SERVICE,
} from './tags'

export interface Metadata {
  ci: {
    job: {
      name?: string
      url?: string
    }
    pipeline: {
      id?: string
      name?: string
      number?: number
      url?: string
    }
    provider: {
      name?: string
    }
    stage: {
      name?: string
    }
    workspace_path?: string
  }
  git: {
    branch?: string
    commit: {
      author: {
        date?: string
        email?: string
        name?: string
      }
      committer: {
        date?: string
        email?: string
        name?: string
      }
      message?: string
      sha?: string
    }
    repository_url?: string
    tag?: string
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
  | typeof CI_ENV_VARS
  | typeof CI_NODE_NAME
  | typeof CI_NODE_LABELS
  | typeof SERVICE

export type SpanTags = Partial<Record<SpanTag, string>>

export type RequestBuilder = (args: AxiosRequestConfig) => AxiosPromise

export type CommandContext = {
  stdout: Writable
  stderr: Writable
}
