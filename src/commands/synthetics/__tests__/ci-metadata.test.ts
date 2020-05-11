import { CI_ENGINES, getCIMetadata } from '../ci-metadata';

describe('ci-metadata', () => {
  const branch = 'fakeBranch';
  const commit = 'fakeCommitSha';
  const pipelineURL = 'fakePipelineUrl';

  test('non-recognized CI returns undefined', () => {
    process.env = { };
    expect(getCIMetadata()).toBeUndefined();
  });

  test('circle CI is recognized', () => {
    process.env = {
      CIRCLECI: 'true',
      CIRCLE_BRANCH: branch,
      CIRCLE_REPOSITORY_URL: pipelineURL,
      CIRCLE_SHA1: commit,
    };
    expect(getCIMetadata()).toEqual({
      branch,
      commit,
      engine: CI_ENGINES.CIRCLECI,
      pipelineURL,
    });
  });

  test('travis CI is recognized', () => {
    process.env = {
      TRAVIS: 'true',
      TRAVIS_BRANCH: branch,
      TRAVIS_COMMIT: commit,
      TRAVIS_JOB_WEB_URL: pipelineURL,
    };
    expect(getCIMetadata()).toEqual({
      branch,
      commit,
      engine: CI_ENGINES.TRAVIS,
      pipelineURL,
    });
  });

  test('gitlab CI is recognized', () => {
    process.env = {
      CI_COMMIT_BRANCH: branch,
      CI_COMMIT_SHA: commit,
      CI_JOB_URL: pipelineURL,
      GITLAB_CI: 'true',
    };
    expect(getCIMetadata()).toEqual({
      branch,
      commit,
      engine: CI_ENGINES.GITLAB,
      pipelineURL,
    });
  });

  test('github actions is recognized', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: branch,
      GITHUB_REPOSITORY: 'DataDog/datadog-ci',
      GITHUB_RUN_ID: '42',
      GITHUB_SHA: commit,
    };

    const expectedPipelineURL = 'https://github.com/DataDog/datadog-ci/actions/runs/42';
    expect(getCIMetadata()).toEqual({
      branch,
      commit,
      engine: CI_ENGINES.GITHUB,
      pipelineURL: expectedPipelineURL,
    });
  });

  test('jenkins is recognized', () => {
    process.env = {
      BUILD_URL: pipelineURL,
      GIT_BRANCH: branch,
      GIT_COMMIT: commit,
      JENKINS_URL: 'https://fakebuildserver.url/',
    };
    expect(getCIMetadata()).toEqual({
      branch,
      commit,
      engine: CI_ENGINES.JENKINS,
      pipelineURL,
    });
  });
});
