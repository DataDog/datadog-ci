import { Metadata } from './interfaces';

export const CI_ENGINES = {
  CIRCLECI: 'circleci',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  JENKINS: 'jenkins',
  TRAVIS: 'travis',
};

export const getCIMetadata = (): Metadata['ci'] => {
  const env = process.env;

  if (env.CIRCLECI) {
    return {
      branch: env.CIRCLE_BRANCH,
      commit: env.CIRCLE_SHA1,
      engine: CI_ENGINES.CIRCLECI,
      pipelineURL: env.CIRCLE_BUILD_URL,
    };
  }

  if (env.TRAVIS) {
    return {
      branch: env.TRAVIS_BRANCH,
      commit: env.TRAVIS_COMMIT,
      engine: CI_ENGINES.TRAVIS,
      pipelineURL: env.TRAVIS_JOB_WEB_URL,
    };
  }

  if (env.GITLAB_CI) {
    return {
      branch: env.CI_COMMIT_BRANCH,
      commit: env.CI_COMMIT_SHA,
      engine: CI_ENGINES.GITLAB,
      pipelineURL: env.CI_JOB_URL,
    };
  }

  if (env.GITHUB_ACTIONS) {
    const pipelineURL = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

    return {
      branch: env.GITHUB_REF,
      commit: env.GITHUB_SHA,
      engine: CI_ENGINES.GITHUB,
      pipelineURL,
    };
  }

  if (env.JENKINS_URL) {
    return {
      branch: env.GIT_BRANCH,
      commit: env.GIT_COMMIT,
      engine: CI_ENGINES.JENKINS,
      pipelineURL: env.BUILD_URL,
    };
  }
};
