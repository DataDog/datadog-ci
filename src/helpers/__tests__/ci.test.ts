import {CI_ENGINES, getCIMetadata, getCISpanTags} from '../ci'
import {getUserGitMetadata} from '../user-provided-git'

import fs from 'fs'
import path from 'path'

describe('getCIMetadata', () => {
  const branch = 'fakeBranch'
  const commit = 'fakeCommitSha'
  const pipelineURL = 'fakePipelineUrl'

  test('non-recognized CI returns undefined', () => {
    process.env = {}
    expect(getCIMetadata()).toBeUndefined()
  })

  test('circle CI is recognized', () => {
    process.env = {
      CIRCLECI: 'true',
      CIRCLE_BRANCH: branch,
      CIRCLE_BUILD_URL: pipelineURL,
      CIRCLE_SHA1: commit,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: pipelineURL},
        provider: {name: CI_ENGINES.CIRCLECI},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })

  test('travis CI is recognized', () => {
    process.env = {
      TRAVIS: 'true',
      TRAVIS_BRANCH: branch,
      TRAVIS_COMMIT: commit,
      TRAVIS_JOB_WEB_URL: pipelineURL,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: pipelineURL},
        provider: {name: CI_ENGINES.TRAVIS},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })

  test('gitlab CI is recognized', () => {
    process.env = {
      CI_COMMIT_BRANCH: branch,
      CI_COMMIT_SHA: commit,
      CI_JOB_URL: pipelineURL,
      GITLAB_CI: 'true',
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: pipelineURL},
        provider: {name: CI_ENGINES.GITLAB},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })

  test('github actions is recognized', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: branch,
      GITHUB_REPOSITORY: 'DataDog/datadog-ci',
      GITHUB_RUN_ID: '42',
      GITHUB_SHA: commit,
    }

    const expectedPipelineURL = 'https://github.com/DataDog/datadog-ci/actions/runs/42'
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: expectedPipelineURL},
        provider: {name: CI_ENGINES.GITHUB},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })

  test('jenkins is recognized', () => {
    process.env = {
      BUILD_URL: pipelineURL,
      GIT_BRANCH: branch,
      GIT_COMMIT: commit,
      JENKINS_URL: 'https://fakebuildserver.url/',
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: pipelineURL},
        provider: {name: CI_ENGINES.JENKINS},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })

  test('jenkins context is recognized', () => {
    process.env = {
      BUILD_URL: pipelineURL,
      GIT_BRANCH: branch,
      GIT_COMMIT: commit,
      JENKINS_URL: 'https://fakebuildserver.url/',
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {url: pipelineURL},
        provider: {name: CI_ENGINES.JENKINS},
      },
      git: {
        branch,
        commitSha: commit,
      },
    })
  })
})

describe('ci spec', () => {
  test('returns an empty object if the CI is not supported', () => {
    process.env = {}
    const tags = {
      ...getCISpanTags(),
      ...getUserGitMetadata(),
    }
    expect(tags).toEqual({})
  })

  const ciProviders = fs.readdirSync(path.join(__dirname, 'ci-env'))
  ciProviders.forEach((ciProvider) => {
    const assertions = require(path.join(__dirname, 'ci-env', ciProvider))

    assertions.forEach(([env, expectedSpanTags]: [{[key: string]: string}, {[key: string]: string}], index: number) => {
      test(`reads env info for spec ${index} from ${ciProvider}`, () => {
        process.env = env
        const tags = {
          ...getCISpanTags(),
          ...getUserGitMetadata(),
        }
        expect(tags).toEqual(expectedSpanTags)
      })
    })
  })
})
