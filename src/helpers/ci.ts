import {URL} from 'url'

import {Metadata} from './interfaces'

export const CI_ENGINES = {
  CIRCLECI: 'circleci',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  JENKINS: 'jenkins',
  TRAVIS: 'travis',
}

const resolveTilde = (filePath: string) => {
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

export const getCIMetadata = (): Metadata | undefined => {
  const env = process.env
  let tags: Metadata | undefined

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
      ci: {
        job: {
          name: CIRCLE_BUILD_URL,
        },
        pipeline: {
          id: CIRCLE_WORKFLOW_ID,
          name: CIRCLE_PROJECT_REPONAME,
          number: CIRCLE_BUILD_NUM,
          url: CIRCLE_BUILD_URL,
        },
        provider: {
          name: CI_ENGINES.CIRCLECI,
        },
        workspacePath: CIRCLE_WORKING_DIRECTORY,
      },
      git: {
        branch: CIRCLE_BRANCH,
        commitSha: CIRCLE_SHA1,
        repositoryUrl: CIRCLE_REPOSITORY_URL,
        tag: CIRCLE_TAG,
      },
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
      ci: {
        job: {
          url: TRAVIS_JOB_WEB_URL,
        },
        pipeline: {
          id: TRAVIS_BUILD_ID,
          name: TRAVIS_REPO_SLUG,
          number: TRAVIS_BUILD_NUMBER,
          url: TRAVIS_BUILD_WEB_URL,
        },
        provider: {
          name: CI_ENGINES.TRAVIS,
        },
        workspacePath: TRAVIS_BUILD_DIR,
      },
      git: {
        branch: TRAVIS_BRANCH,
        commitSha: TRAVIS_COMMIT,
        repositoryUrl: `https://github.com/${TRAVIS_REPO_SLUG}.git`,
        tag: TRAVIS_TAG,
      },
    }
  }

  if (env.GITLAB_CI) {
    const {
      CI_PIPELINE_ID,
      CI_PROJECT_PATH,
      CI_PIPELINE_IID,
      CI_PIPELINE_URL,
      CI_PROJECT_DIR,
      CI_COMMIT_BRANCH,
      CI_COMMIT_TAG,
      CI_COMMIT_SHA,
      CI_REPOSITORY_URL,
      CI_JOB_URL,
      CI_JOB_STAGE,
      CI_JOB_NAME,
    } = env
    tags = {
      ci: {
        job: {
          name: CI_JOB_NAME,
          url: CI_JOB_URL,
        },
        pipeline: {
          id: CI_PIPELINE_ID,
          name: CI_PROJECT_PATH,
          number: CI_PIPELINE_IID,
          url: CI_PIPELINE_URL && CI_PIPELINE_URL.replace('/-/pipelines/', '/pipelines/'),
        },
        provider: {
          name: CI_ENGINES.GITLAB,
        },
        stage: {
          name: CI_JOB_STAGE,
        },
        workspacePath: CI_PROJECT_DIR,
      },
      git: {
        branch: CI_COMMIT_BRANCH,
        commitSha: CI_COMMIT_SHA,
        repositoryUrl: CI_REPOSITORY_URL,
        tag: CI_COMMIT_TAG,
      },
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
      ci: {
        job: {
          url: pipelineURL,
        },
        pipeline: {
          id: GITHUB_RUN_ID,
          name: GITHUB_WORKFLOW,
          number: GITHUB_RUN_NUMBER,
          url: pipelineURL,
        },
        provider: {
          name: CI_ENGINES.GITHUB,
        },
        workspacePath: GITHUB_WORKSPACE,
      },
      git: {
        branch: GITHUB_REF,
        commitSha: GITHUB_SHA,
        repositoryUrl,
      },
    }
  }

  if (env.JENKINS_URL) {
    const {WORKSPACE, BUILD_TAG, JOB_NAME, BUILD_NUMBER, BUILD_URL, GIT_BRANCH, GIT_COMMIT, GIT_URL} = env

    tags = {
      ci: {
        pipeline: {
          id: BUILD_TAG,
          name: JOB_NAME,
          number: BUILD_NUMBER,
          url: BUILD_URL,
        },
        provider: {
          name: CI_ENGINES.JENKINS,
        },
        workspacePath: WORKSPACE,
      },
      git: {
        branch: GIT_BRANCH,
        commitSha: GIT_COMMIT,
        repositoryUrl: GIT_URL,
      },
    }
  }
  if (tags?.ci?.workspacePath) {
    tags.ci.workspacePath = resolveTilde(tags.ci.workspacePath)
  }
  if (tags?.git.repositoryUrl) {
    tags.git.repositoryUrl = filterSensitiveInfoFromRepository(tags.git.repositoryUrl)
  }
  if (tags?.git.branch) {
    tags.git.branch = normalizeRef(tags.git.branch)
  }
  if (tags?.git.tag) {
    tags.git.tag = normalizeRef(tags.git.tag)
  }

  return tags
}
