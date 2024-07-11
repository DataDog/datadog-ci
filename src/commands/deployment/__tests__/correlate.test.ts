import {Cli} from 'clipanion/lib/advanced'

import {createMockContext} from '../../../helpers/__tests__/fixtures'

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
      CI_PROJECT_URL: 'https://gitlab.com/DataDog/example',
      CI_PIPELINE_ID: '1',
      CI_JOB_ID: '1',
    }
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Could not extract the source code repository URL')
  })
  test('no git commit sha on environment variables', async () => {
    const envVars = {
      GITLAB_CI: 'placeholder',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
      CI_PROJECT_URL: 'https://gitlab.com/DataDog/example',
      CI_PIPELINE_ID: '1',
      CI_JOB_ID: '1',
    }
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Could not extract the source git commit sha')
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
    const {context, code} = await runCLI(['--provider', 'argocd', '--dry-run'], envVars)
    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain(`"type": "ci_app_deployment_correlate"`)
    expect(output).toContain(`"attributes"`)
    expect(output).toContain(`"ci_provider": "gitlab"`)
    expect(output).toContain(`"cd_provider": "argocd"`)
    expect(output).toContain(`"config_repo_url"`)
    expect(output).toContain(`"config_commit_shas"`)
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
})
