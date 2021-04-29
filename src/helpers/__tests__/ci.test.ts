import {CI_ENGINES, getCIMetadata, getCISpanTags} from '../ci'
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
} from '../tags'

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

describe('getCISpanTags', () => {
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

  test('non-recognized CI returns empty dictionary', () => {
    process.env = {}
    expect(getCISpanTags()).toEqual({})
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
    expect(getCISpanTags()).toEqual({
      [CI_JOB_URL]: pipelineURL,
      [CI_PIPELINE_ID]: pipelineId,
      [CI_PIPELINE_NAME]: pipelineName,
      [CI_PIPELINE_NUMBER]: pipelineNumber,
      [CI_PIPELINE_URL]: pipelineURL,
      [CI_PROVIDER_NAME]: CI_ENGINES.CIRCLECI,
      [CI_WORKSPACE_PATH]: workspacePath,
      [GIT_BRANCH]: branch,
      [GIT_SHA]: commit,
      [GIT_REPOSITORY_URL]: repositoryUrl,
      [GIT_TAG]: tag,
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
    expect(getCISpanTags()).toEqual({
      [CI_JOB_URL]: jobUrl,
      [CI_PIPELINE_ID]: pipelineId,
      [CI_PIPELINE_NAME]: pipelineName,
      [CI_PIPELINE_NUMBER]: pipelineNumber,
      [CI_PIPELINE_URL]: pipelineURL,
      [CI_PROVIDER_NAME]: CI_ENGINES.TRAVIS,
      [CI_WORKSPACE_PATH]: workspacePath,
      [GIT_BRANCH]: branch,
      [GIT_SHA]: commit,
      [GIT_REPOSITORY_URL]: `https://github.com/${pipelineName}.git`,
      [GIT_TAG]: tag,
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
    expect(getCISpanTags()).toEqual({
      [CI_JOB_NAME]: jobName,
      [CI_JOB_URL]: jobUrl,
      [CI_PIPELINE_ID]: pipelineId,
      [CI_PIPELINE_NAME]: pipelineName,
      [CI_PIPELINE_NUMBER]: pipelineNumber,
      [CI_PIPELINE_URL]: pipelineURL,
      [CI_PROVIDER_NAME]: CI_ENGINES.GITLAB,
      [CI_STAGE_NAME]: stageName,
      [CI_WORKSPACE_PATH]: workspacePath,
      [GIT_BRANCH]: branch,
      [GIT_SHA]: commit,
      [GIT_REPOSITORY_URL]: repositoryUrl,
      [GIT_TAG]: tag,
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
    expect(getCISpanTags()).toEqual({
      [CI_JOB_URL]: expectedPipelineUrl,
      [CI_PIPELINE_ID]: pipelineId,
      [CI_PIPELINE_NAME]: pipelineName,
      [CI_PIPELINE_NUMBER]: pipelineNumber,
      [CI_PIPELINE_URL]: expectedPipelineUrl,
      [CI_PROVIDER_NAME]: CI_ENGINES.GITHUB,
      [CI_WORKSPACE_PATH]: workspacePath,
      [GIT_BRANCH]: branch,
      [GIT_SHA]: commit,
      [GIT_REPOSITORY_URL]: expectedRepositoryUrl,
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
    expect(getCISpanTags()).toEqual({
      [CI_PIPELINE_ID]: pipelineId,
      [CI_PIPELINE_NAME]: pipelineName,
      [CI_PIPELINE_NUMBER]: pipelineNumber,
      [CI_PIPELINE_URL]: pipelineURL,
      [CI_PROVIDER_NAME]: CI_ENGINES.JENKINS,
      [CI_WORKSPACE_PATH]: workspacePath,
      [GIT_BRANCH]: branch,
      [GIT_SHA]: commit,
      [GIT_REPOSITORY_URL]: repositoryUrl,
    })
  })
})
