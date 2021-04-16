import {CI_ENGINES, getCIMetadata} from '../ci'
import {CI_ENV_PARENT_SPAN_ID, CI_ENV_TRACE_ID} from '../tags'

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
      CIRCLE_TAG: tag,
      CIRCLE_BUILD_URL: pipelineURL,
      CIRCLE_SHA1: commit,
      CIRCLE_WORKFLOW_ID: pipelineId,
      CIRCLE_PROJECT_REPONAME: pipelineName,
      CIRCLE_BUILD_NUM: pipelineNumber,
      CIRCLE_WORKING_DIRECTORY: workspacePath,
      CIRCLE_REPOSITORY_URL: repositoryUrl,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          name: pipelineURL,
        },
        workspacePath,
        pipeline: {name: pipelineName, id: pipelineId, url: pipelineURL, number: pipelineNumber},
        provider: {name: CI_ENGINES.CIRCLECI},
      },
      git: {
        tag,
        repositoryUrl,
        branch,
        commitSha: commit,
      },
    })
  })

  test('travis CI is recognized', () => {
    process.env = {
      TRAVIS: 'true',
      TRAVIS_BRANCH: branch,
      TRAVIS_TAG: tag,
      TRAVIS_COMMIT: commit,
      TRAVIS_JOB_WEB_URL: jobUrl,
      TRAVIS_REPO_SLUG: pipelineName,
      TRAVIS_BUILD_ID: pipelineId,
      TRAVIS_BUILD_NUMBER: pipelineNumber,
      TRAVIS_BUILD_WEB_URL: pipelineURL,
      TRAVIS_BUILD_DIR: workspacePath,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          url: jobUrl,
        },
        workspacePath,
        pipeline: {
          name: pipelineName,
          id: pipelineId,
          url: pipelineURL,
          number: pipelineNumber,
        },
        provider: {name: CI_ENGINES.TRAVIS},
      },
      git: {
        tag,
        repositoryUrl: `https://github.com/${pipelineName}.git`,
        branch,
        commitSha: commit,
      },
    })
  })

  test('gitlab CI is recognized', () => {
    process.env = {
      CI_COMMIT_BRANCH: branch,
      CI_COMMIT_TAG: tag,
      CI_COMMIT_SHA: commit,
      CI_JOB_URL: jobUrl,
      GITLAB_CI: 'true',
      CI_PIPELINE_ID: pipelineId,
      CI_PROJECT_PATH: pipelineName,
      CI_PIPELINE_IID: pipelineNumber,
      CI_PIPELINE_URL: pipelineURL,
      CI_PROJECT_DIR: workspacePath,
      CI_REPOSITORY_URL: repositoryUrl,
      CI_JOB_STAGE: stageName,
      CI_JOB_NAME: jobName,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        stage: {
          name: stageName,
        },
        job: {
          url: jobUrl,
          name: jobName,
        },
        workspacePath,
        pipeline: {
          name: pipelineName,
          id: pipelineId,
          url: pipelineURL,
          number: pipelineNumber,
        },
        provider: {name: CI_ENGINES.GITLAB},
      },
      git: {
        tag,
        repositoryUrl,
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
      GITHUB_RUN_ID: pipelineId,
      GITHUB_SHA: commit,
      GITHUB_WORKFLOW: pipelineName,
      GITHUB_RUN_NUMBER: pipelineNumber,
      GITHUB_WORKSPACE: workspacePath,
    }
    const expectedRepositoryUrl = `https://github.com/DataDog/datadog-ci.git`
    const expectedPipelineUrl = `https://github.com/DataDog/datadog-ci/commit/${commit}/checks`
    expect(getCIMetadata()).toEqual({
      ci: {
        job: {
          url: expectedPipelineUrl,
        },
        workspacePath,
        pipeline: {
          name: pipelineName,
          id: pipelineId,
          url: expectedPipelineUrl,
          number: pipelineNumber,
        },
        provider: {name: CI_ENGINES.GITHUB},
      },
      git: {
        repositoryUrl: expectedRepositoryUrl,
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
      WORKSPACE: workspacePath,
      BUILD_TAG: pipelineId,
      JOB_NAME: pipelineName,
      BUILD_NUMBER: pipelineNumber,
      GIT_URL: repositoryUrl,
    }
    expect(getCIMetadata()).toEqual({
      ci: {
        workspacePath,
        pipeline: {
          name: pipelineName,
          id: pipelineId,
          url: pipelineURL,
          number: pipelineNumber,
        },
        provider: {name: CI_ENGINES.JENKINS},
      },
      git: {
        repositoryUrl: repositoryUrl,
        branch,
        commitSha: commit,
      },
    })
  })
})
