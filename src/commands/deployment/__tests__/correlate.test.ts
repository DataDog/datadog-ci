import {Cli} from 'clipanion/lib/advanced'

import {createMockContext, getAxiosError} from '../../../helpers/__tests__/fixtures'

import {DeploymentCorrelateCommand} from '../correlate'

describe('execute', () => {
  const runCLI = async (extraArgs: string[], extraEnv?: Record<string, string>) => {
    const cli = new Cli()
    cli.register(DeploymentCorrelateCommand)
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER', ...extraEnv}
    context.env = process.env
    const code = await cli.run(['deployment', 'correlate', ...extraArgs], context)

    return {context, code}
  }
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
  test('no configuration commit shas', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
      CI_COMMIT_SHA: 'abcdef',
    }
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain(
      'Could not retrieve commit SHAs, commit changes and then call this command or provide them with --config-shas'
    )
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
    const command = new DeploymentCorrelateCommand()
    command['context'] = createMockContext() as any

    const axiosError = getAxiosError(400, {
      message: 'Request failed with status code 400',
      errors: ['Some validation error'],
    })

    command['handleError'](axiosError)

    expect(command['context'].stdout.toString()).toStrictEqual(
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
