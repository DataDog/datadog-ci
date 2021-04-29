import {URL} from 'url'

import {Metadata, SpanTag, SpanTags} from './interfaces'
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
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
} from './tags'

export const CI_ENGINES = {
  CIRCLECI: 'circleci',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  JENKINS: 'jenkins',
  TRAVIS: 'travis',
}

const removeEmptyValues = (tags: SpanTags) =>
  (Object.keys(tags) as SpanTag[]).reduce((filteredTags, tag) => {
    if (!tags[tag]) {
      return filteredTags
    }

    return {
      ...filteredTags,
      [tag]: tags[tag],
    }
  }, {})

const resolveTilde = (filePath: string | undefined) => {
  if (!filePath || typeof filePath !== 'string') {
    return ''
  }
  // '~/folder/path' or '~'
  if (filePath[0] === '~' && (filePath[1] === '/' || filePath.length === 1)) {
    return filePath.replace('~', process.env.HOME ?? '')
  }

  return filePath
}

const filterSensitiveInfoFromRepository = (repositoryUrl: string) => {
  if (repositoryUrl.startsWith('git@')) {
    return repositoryUrl
  }
  try {
    const {protocol, hostname, pathname} = new URL(repositoryUrl)
    if (!protocol || !hostname) {
      return repositoryUrl
    }

    return `${protocol}//${hostname}${pathname}`
  } catch (e) {
    return repositoryUrl
  }
}

const normalizeRef = (ref: string) => {
  if (!ref) {
    return ref
  }

  return ref.replace(/origin\/|refs\/heads\/|tags\//gm, '')
}

export const getCISpanTags = (): SpanTags | undefined => {
  const env = process.env
  let tags: SpanTags = {}

  if (env.CIRCLECI) {
    const {
      CIRCLE_WORKFLOW_ID,
      CIRCLE_PROJECT_REPONAME,
      CIRCLE_BUILD_NUM,
      CIRCLE_BUILD_URL,
      CIRCLE_WORKING_DIRECTORY,
      CIRCLE_BRANCH,
      CIRCLE_TAG,
      CIRCLE_SHA1,
      CIRCLE_REPOSITORY_URL,
    } = env
    tags = {
      [CI_JOB_URL]: CIRCLE_BUILD_URL,
      [CI_PIPELINE_ID]: CIRCLE_WORKFLOW_ID,
      [CI_PIPELINE_NAME]: CIRCLE_PROJECT_REPONAME,
      [CI_PIPELINE_NUMBER]: CIRCLE_BUILD_NUM,
      [CI_PIPELINE_URL]: CIRCLE_BUILD_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.CIRCLECI,
      [CI_WORKSPACE_PATH]: CIRCLE_WORKING_DIRECTORY,
      [GIT_BRANCH]: CIRCLE_BRANCH,
      [GIT_SHA]: CIRCLE_SHA1,
      [GIT_REPOSITORY_URL]: CIRCLE_REPOSITORY_URL,
      [GIT_TAG]: CIRCLE_TAG,
    }
  }

  if (env.TRAVIS) {
    const {
      TRAVIS_BRANCH,
      TRAVIS_COMMIT,
      TRAVIS_REPO_SLUG,
      TRAVIS_TAG,
      TRAVIS_JOB_WEB_URL,
      TRAVIS_BUILD_ID,
      TRAVIS_BUILD_NUMBER,
      TRAVIS_BUILD_WEB_URL,
      TRAVIS_BUILD_DIR,
    } = env
    tags = {
      [CI_JOB_URL]: TRAVIS_JOB_WEB_URL,
      [CI_PIPELINE_ID]: TRAVIS_BUILD_ID,
      [CI_PIPELINE_NAME]: TRAVIS_REPO_SLUG,
      [CI_PIPELINE_NUMBER]: TRAVIS_BUILD_NUMBER,
      [CI_PIPELINE_URL]: TRAVIS_BUILD_WEB_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.TRAVIS,
      [CI_WORKSPACE_PATH]: TRAVIS_BUILD_DIR,
      [GIT_BRANCH]: TRAVIS_BRANCH,
      [GIT_SHA]: TRAVIS_COMMIT,
      [GIT_REPOSITORY_URL]: `https://github.com/${TRAVIS_REPO_SLUG}.git`,
      [GIT_TAG]: TRAVIS_TAG,
    }
  }

  if (env.GITLAB_CI) {
    const {
      CI_PIPELINE_ID: GITLAB_CI_PIPELINE_ID,
      CI_PROJECT_PATH,
      CI_PIPELINE_IID,
      CI_PIPELINE_URL: GITLAB_CI_PIPELINE_URL,
      CI_PROJECT_DIR,
      CI_COMMIT_BRANCH,
      CI_COMMIT_TAG,
      CI_COMMIT_SHA,
      CI_REPOSITORY_URL,
      CI_JOB_URL: GITLAB_CI_JOB_URL,
      CI_JOB_STAGE,
      CI_JOB_NAME: GITLAB_CI_JOB_NAME,
    } = env
    tags = {
      [CI_JOB_NAME]: GITLAB_CI_JOB_NAME,
      [CI_JOB_URL]: GITLAB_CI_JOB_URL,
      [CI_PIPELINE_ID]: GITLAB_CI_PIPELINE_ID,
      [CI_PIPELINE_NAME]: CI_PROJECT_PATH,
      [CI_PIPELINE_NUMBER]: CI_PIPELINE_IID,
      [CI_PIPELINE_URL]: GITLAB_CI_PIPELINE_URL && GITLAB_CI_PIPELINE_URL.replace('/-/pipelines/', '/pipelines/'),
      [CI_PROVIDER_NAME]: CI_ENGINES.GITLAB,
      [CI_WORKSPACE_PATH]: CI_PROJECT_DIR,
      [CI_STAGE_NAME]: CI_JOB_STAGE,
      [GIT_BRANCH]: CI_COMMIT_BRANCH,
      [GIT_SHA]: CI_COMMIT_SHA,
      [GIT_REPOSITORY_URL]: CI_REPOSITORY_URL,
      [GIT_TAG]: CI_COMMIT_TAG,
    }
  }

  if (env.GITHUB_ACTIONS || env.GITHUB_ACTION) {
    const {
      GITHUB_RUN_ID,
      GITHUB_WORKFLOW,
      GITHUB_RUN_NUMBER,
      GITHUB_WORKSPACE,
      GITHUB_REF,
      GITHUB_SHA,
      GITHUB_REPOSITORY,
    } = env
    const repositoryUrl = `https://github.com/${GITHUB_REPOSITORY}.git`
    const pipelineURL = `https://github.com/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}/checks`

    tags = {
      [CI_JOB_URL]: pipelineURL,
      [CI_PIPELINE_ID]: GITHUB_RUN_ID,
      [CI_PIPELINE_NAME]: GITHUB_WORKFLOW,
      [CI_PIPELINE_NUMBER]: GITHUB_RUN_NUMBER,
      [CI_PIPELINE_URL]: pipelineURL,
      [CI_PROVIDER_NAME]: CI_ENGINES.GITHUB,
      [CI_WORKSPACE_PATH]: GITHUB_WORKSPACE,
      [GIT_BRANCH]: GITHUB_REF,
      [GIT_SHA]: GITHUB_SHA,
      [GIT_REPOSITORY_URL]: repositoryUrl,
    }
  }

  if (env.JENKINS_URL) {
    const {
      WORKSPACE,
      BUILD_TAG,
      JOB_NAME,
      BUILD_NUMBER,
      BUILD_URL,
      GIT_BRANCH: JENKINS_GIT_BRANCH,
      GIT_COMMIT,
      GIT_URL,
    } = env

    tags = {
      [CI_PIPELINE_ID]: BUILD_TAG,
      [CI_PIPELINE_NAME]: JOB_NAME,
      [CI_PIPELINE_NUMBER]: BUILD_NUMBER,
      [CI_PIPELINE_URL]: BUILD_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.JENKINS,
      [CI_WORKSPACE_PATH]: WORKSPACE,
      [GIT_BRANCH]: JENKINS_GIT_BRANCH,
      [GIT_SHA]: GIT_COMMIT,
      [GIT_REPOSITORY_URL]: GIT_URL,
    }
  }
  if (tags[CI_WORKSPACE_PATH]) {
    tags[CI_WORKSPACE_PATH] = resolveTilde(tags[CI_WORKSPACE_PATH]!)
  }
  if (tags[GIT_REPOSITORY_URL]) {
    tags[GIT_REPOSITORY_URL] = filterSensitiveInfoFromRepository(tags[GIT_REPOSITORY_URL]!)
  }
  if (tags[GIT_BRANCH]) {
    tags[GIT_BRANCH] = normalizeRef(tags[GIT_BRANCH]!)
  }
  if (tags[GIT_TAG]) {
    tags[GIT_TAG] = normalizeRef(tags[GIT_TAG]!)
  }

  return removeEmptyValues(tags)
}

export const getCIMetadata = (): Metadata | undefined => {
  const env = process.env

  if (env.CIRCLECI) {
    return {
      ci: {
        pipeline: {
          url: env.CIRCLE_BUILD_URL,
        },
        provider: {
          name: CI_ENGINES.CIRCLECI,
        },
      },
      git: {
        branch: env.CIRCLE_BRANCH,
        commitSha: env.CIRCLE_SHA1,
      },
    }
  }

  if (env.TRAVIS) {
    return {
      ci: {
        pipeline: {
          url: env.TRAVIS_JOB_WEB_URL,
        },
        provider: {
          name: CI_ENGINES.TRAVIS,
        },
      },
      git: {
        branch: env.TRAVIS_BRANCH,
        commitSha: env.TRAVIS_COMMIT,
      },
    }
  }

  if (env.GITLAB_CI) {
    return {
      ci: {
        pipeline: {
          url: env.CI_JOB_URL,
        },
        provider: {
          name: CI_ENGINES.GITLAB,
        },
      },
      git: {
        branch: env.CI_COMMIT_BRANCH,
        commitSha: env.CI_COMMIT_SHA,
      },
    }
  }

  if (env.GITHUB_ACTIONS) {
    const {GITHUB_REF, GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_RUN_ID} = env

    const pipelineURL = `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`

    return {
      ci: {
        pipeline: {
          url: pipelineURL,
        },
        provider: {
          name: CI_ENGINES.GITHUB,
        },
      },
      git: {
        branch: GITHUB_REF,
        commitSha: GITHUB_SHA,
      },
    }
  }

  if (env.JENKINS_URL) {
    const {BUILD_URL, GIT_COMMIT, GIT_BRANCH: JENKINS_GIT_BRANCH} = env

    return {
      ci: {
        pipeline: {
          url: BUILD_URL,
        },
        provider: {
          name: CI_ENGINES.JENKINS,
        },
      },
      git: {
        branch: JENKINS_GIT_BRANCH,
        commitSha: GIT_COMMIT,
      },
    }
  }
}
