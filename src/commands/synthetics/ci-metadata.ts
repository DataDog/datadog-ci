import {Metadata} from './interfaces'

export const CI_ENGINES = {
  CIRCLECI: 'circleci',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  JENKINS: 'jenkins',
  TRAVIS: 'travis',
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
        commit_sha: env.CIRCLE_SHA1,
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
        commit_sha: env.TRAVIS_COMMIT,
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
        commit_sha: env.CI_COMMIT_SHA,
      },
    }
  }

  if (env.GITHUB_ACTIONS) {
    const pipelineURL = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`

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
        branch: env.GITHUB_REF,
        commit_sha: env.GITHUB_SHA,
      },
    }
  }

  if (env.JENKINS_URL) {
    return {
      ci: {
        pipeline: {
          url: env.BUILD_URL,
        },
        provider: {
          name: CI_ENGINES.JENKINS,
        },
      },
      git: {
        branch: env.GIT_BRANCH,
        commit_sha: env.GIT_COMMIT,
      },
    }
  }
}
