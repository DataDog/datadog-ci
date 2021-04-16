import {CI_ENGINES, getCIMetadata} from '../ci'

describe('ci-metadata', () => {
  const branch = 'fakeBranch'
  const tag = 'fakeTag'
  const commit = 'fakeCommitSha'
  const pipelineURL = 'fakePipelineUrl'
  const pipelineId = 'fakePipelineId'
  const pipelineName = 'fakePipelineName'
  const pipelineNumber = 'fakePipelineNumber'
  const workspacePath = 'fakeWorkspacePath'
  const repositoryUrl = 'fakeRepositoryUrl'
  const jobUrl = 'fakeJobUrl'
  const stageName = 'fakeStageName'
  const jobName = 'fakeJobName'

  test('non-recognized CI returns undefined', () => {
    process.env = {}
    expect(getCIMetadata()).toBeUndefined()
  })

  test('circle CI is recognized', () => {
    process.env = {
      CIRCLECI: 'true',
      CIRCLE_BRANCH: branch,
      CIRCLE_BUILD_NUM: pipelineNumber,
      CIRCLE_BUILD_URL: pipelineURL,
      CIRCLE_PROJECT_REPONAME: pipelineName,
      CIRCLE_REPOSITORY_URL: repositoryUrl,
      CIRCLE_SHA1: commit,
      CIRCLE_TAG: tag,
      CIRCLE_WORKFLOW_ID: pipelineId,
      CIRCLE_WORKING_DIRECTORY: workspacePath,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          name: pipelineURL,
        },
        pipeline: {name: pipelineName, id: pipelineId, url: pipelineURL, number: pipelineNumber},
        provider: {name: CI_ENGINES.CIRCLECI},
        workspacePath,
      },
      git: {
        branch,
        commitSha: commit,
        repositoryUrl,
        tag,
      },
    })
  })

  test('travis CI is recognized', () => {
    process.env = {
      TRAVIS: 'true',
      TRAVIS_BRANCH: branch,
      TRAVIS_BUILD_DIR: workspacePath,
      TRAVIS_BUILD_ID: pipelineId,
      TRAVIS_BUILD_NUMBER: pipelineNumber,
      TRAVIS_BUILD_WEB_URL: pipelineURL,
      TRAVIS_COMMIT: commit,
      TRAVIS_JOB_WEB_URL: jobUrl,
      TRAVIS_REPO_SLUG: pipelineName,
      TRAVIS_TAG: tag,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          url: jobUrl,
        },
        pipeline: {
          id: pipelineId,
          name: pipelineName,
          number: pipelineNumber,
          url: pipelineURL,
        },
        provider: {name: CI_ENGINES.TRAVIS},
        workspacePath,
      },
      git: {
        branch,
        commitSha: commit,
        repositoryUrl: `https://github.com/${pipelineName}.git`,
        tag,
      },
    })
  })

  test('gitlab CI is recognized', () => {
    process.env = {
      CI_COMMIT_BRANCH: branch,
      CI_COMMIT_SHA: commit,
      CI_COMMIT_TAG: tag,
      CI_JOB_NAME: jobName,
      CI_JOB_STAGE: stageName,
      CI_JOB_URL: jobUrl,
      CI_PIPELINE_ID: pipelineId,
      CI_PIPELINE_IID: pipelineNumber,
      CI_PIPELINE_URL: pipelineURL,
      CI_PROJECT_DIR: workspacePath,
      CI_PROJECT_PATH: pipelineName,
      CI_REPOSITORY_URL: repositoryUrl,
      GITLAB_CI: 'true',
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          name: jobName,
          url: jobUrl,
        },
        pipeline: {
          id: pipelineId,
          name: pipelineName,
          number: pipelineNumber,
          url: pipelineURL,
        },
        provider: {name: CI_ENGINES.GITLAB},
        stage: {
          name: stageName,
        },
        workspacePath,
      },
      git: {
        branch,
        commitSha: commit,
        repositoryUrl,
        tag,
      },
    })
  })

  test('github actions is recognized', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: branch,
      GITHUB_REPOSITORY: 'DataDog/datadog-ci',
      GITHUB_RUN_ID: pipelineId,
      GITHUB_RUN_NUMBER: pipelineNumber,
      GITHUB_SHA: commit,
      GITHUB_WORKFLOW: pipelineName,
      GITHUB_WORKSPACE: workspacePath,
    }
    const expectedRepositoryUrl = 'https://github.com/DataDog/datadog-ci.git'
    const expectedPipelineUrl = `https://github.com/DataDog/datadog-ci/commit/${commit}/checks`
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          url: expectedPipelineUrl,
        },
        pipeline: {
          id: pipelineId,
          name: pipelineName,
          number: pipelineNumber,
          url: expectedPipelineUrl,
        },
        provider: {name: CI_ENGINES.GITHUB},
        workspacePath,
      },
      git: {
        branch,
        commitSha: commit,
        repositoryUrl: expectedRepositoryUrl,
      },
    })
  })

  test('jenkins is recognized', () => {
    process.env = {
      BUILD_NUMBER: pipelineNumber,
      BUILD_TAG: pipelineId,
      BUILD_URL: pipelineURL,
      GIT_BRANCH: branch,
      GIT_COMMIT: commit,
      GIT_URL: repositoryUrl,
      JENKINS_URL: 'https://fakebuildserver.url/',
      JOB_NAME: pipelineName,
      WORKSPACE: workspacePath,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        pipeline: {
          id: pipelineId,
          name: pipelineName,
          number: pipelineNumber,
          url: pipelineURL,
        },
        provider: {name: CI_ENGINES.JENKINS},
        workspacePath,
      },
      git: {
        branch,
        commitSha: commit,
        repositoryUrl,
      },
    })
  })
})
