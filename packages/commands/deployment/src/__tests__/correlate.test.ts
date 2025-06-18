import {createCommand, getAxiosError, makeRunCLI} from '@datadog/datadog-ci-core/helpers/__tests__/testing-tools'

import {DeploymentCorrelateCommand} from '../correlate'

describe('execute', () => {
  const runCLI = makeRunCLI(DeploymentCorrelateCommand, ['deployment', 'correlate'])

  test('no arguments', async () => {
    const {context, code} = await runCLI([])
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Missing CD provider')
  })

  test('no repository URL on environment variables', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_COMMIT_SHA: 'abcdef',
    }
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Could not extract the source code repository URL')
  })

  test('no git commit sha on environment variables', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
    }
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Could not extract the commit SHA from the CI environment variables')
  })

  test('valid with minimal data', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
      CI_COMMIT_SHA: 'abcdef',
    }
    const {context: _, code} = await runCLI(['--provider', 'argocd', '--config-shas', 'abcdef', '--dry-run'], envVars)
    expect(code).toBe(0)
  })

  test('valid', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_PROJECT_URL: 'https://gitlab.com/DataDog/example',
      CI_COMMIT_SHA: 'abcdef',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
      CI_PIPELINE_ID: '1',
      CI_JOB_ID: '1',
    }
    const {context, code} = await runCLI(
      ['--provider', 'argocd', '--config-shas', 'abcdef', '--config-shas', 'fedcba', '--dry-run'],
      envVars
    )
    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain(`"type": "ci_app_deployment_correlate"`)
    expect(output).toContain(`"attributes"`)
    expect(output).toContain(`"ci_provider": "gitlab"`)
    expect(output).toContain(`"cd_provider": "argocd"`)
    expect(output).toContain(`"config_repo_url"`)
    expect(output).toContain(`"config_commit_shas": [
      "abcdef",
      "fedcba"
    ]`)
    expect(output).toContain(`"ci_env": {
      "ci.pipeline.id": "1",
      "ci.provider.name": "gitlab",
      "git.commit.sha": "abcdef",
      "git.repository_url": "https://github.com/DataDog/example",
      "CI_PROJECT_URL": "https://gitlab.com/DataDog/example",
      "CI_PIPELINE_ID": "1",
      "CI_JOB_ID": "1"
    }`)
  })

  test('handleError', async () => {
    const command = createCommand(DeploymentCorrelateCommand)

    const axiosError = getAxiosError(400, {
      message: 'Request failed with status code 400',
      errors: ['Some validation error'],
    })

    command['handleError'](axiosError)

    expect(command.context.stderr.toString()).toStrictEqual(
      `[ERROR] Could not send deployment correlation data: {
  "status": 400,
  "response": {
    "errors": [
      "Some validation error"
    ]
  }
}\n`
    )
  })
})
