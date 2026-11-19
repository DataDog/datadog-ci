import {createCommand, getRequestError, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as requestModule from '@datadog/datadog-ci-base/helpers/request'

import {PluginCommand as DeploymentCorrelateImageCommand} from '../commands/correlate-image'

describe('execute', () => {
  const runCLI = makeRunCLI(DeploymentCorrelateImageCommand, ['deployment', 'correlate-image'])

  test('no arguments', async () => {
    const {context, code} = await runCLI([])
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Missing commit SHA')
  })

  test('missing commit SHA', async () => {
    const {context, code} = await runCLI([
      '--repository-url',
      'https://github.com/DataDog/example',
      '--image',
      'my-image:latest',
    ])
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Missing commit SHA')
  })

  test('missing repository URL', async () => {
    const {context, code} = await runCLI(['--commit-sha', 'abcdef', '--image', 'my-image:latest'])
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Missing repository URL')
  })

  test('missing image', async () => {
    const {context, code} = await runCLI([
      '--commit-sha',
      'abcdef',
      '--repository-url',
      'https://github.com/DataDog/example',
    ])
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain('Missing image')
  })

  test('valid with dry run', async () => {
    const envVars = {
      DD_API_KEY: 'fake-api-key',
      DD_APP_KEY: 'fake-app-key',
    }
    const {context, code} = await runCLI(
      [
        '--commit-sha',
        'abcdef',
        '--repository-url',
        'https://github.com/DataDog/example',
        '--image',
        'my-image:latest',
        '--dry-run',
      ],
      envVars
    )
    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain('"type": "ci_deployment_correlate_image"')
    expect(output).toContain('"attributes"')
    expect(output).toContain('"commit_sha": "abcdef"')
    expect(output).toContain('"repository_url": "https://github.com/DataDog/example"')
    expect(output).toContain('"image": "my-image:latest"')
    expect(output).toContain('"ci_env"')
  })

  test('valid with dry run includes ci_env from CI environment', async () => {
    const envVars = {
      DD_API_KEY: 'fake-api-key',
      DD_APP_KEY: 'fake-app-key',
      GITLAB_CI: 'placeholder',
      CI_PROJECT_URL: 'https://gitlab.com/DataDog/example',
      CI_COMMIT_SHA: 'abcdef',
      CI_REPOSITORY_URL: 'https://github.com/DataDog/example',
      CI_PIPELINE_ID: '1',
      CI_JOB_ID: '1',
    }
    const {context, code} = await runCLI(
      [
        '--commit-sha',
        'abcdef',
        '--repository-url',
        'https://github.com/DataDog/example',
        '--image',
        'my-image:latest',
        '--dry-run',
      ],
      envVars
    )
    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain(`"ci_env": {
      "ci.job.id": "1",
      "ci.pipeline.id": "1",
      "ci.provider.name": "gitlab",
      "git.commit.sha": "abcdef",
      "git.repository_url": "https://github.com/DataDog/example",
      "CI_PROJECT_URL": "https://gitlab.com/DataDog/example",
      "CI_PIPELINE_ID": "1",
      "CI_JOB_ID": "1"
    }`)
  })

  const validArgs = [
    '--commit-sha',
    'abcdef',
    '--repository-url',
    'https://github.com/DataDog/example',
    '--image',
    'my-image:latest',
  ]

  test('missing application key and access token', async () => {
    const {context, code} = await runCLI(validArgs, {DD_APP_KEY: '', DATADOG_APP_KEY: ''})
    expect(code).toBe(1)
    expect(context.stdout.toString()).toContain(
      '`deployment correlate-image` needs an application key (DD_APP_KEY) or an access token (DD_ACCESS_TOKEN).'
    )
  })

  test('sends a bearer token and no application key when an access token is set', async () => {
    const httpRequestSpy = jest
      .spyOn(requestModule, 'httpRequest')
      .mockResolvedValue({config: {}, data: {}, headers: {}, status: 202, statusText: 'Accepted'})

    try {
      const {code} = await runCLI(validArgs, {DD_API_KEY: '', DD_APP_KEY: '', DD_ACCESS_TOKEN: 'access-token'})

      expect(code).toBe(0)
      expect(httpRequestSpy).toHaveBeenCalledTimes(1)
      expect(httpRequestSpy.mock.calls[0][0].headers).toStrictEqual({Authorization: 'Bearer access-token'})
    } finally {
      httpRequestSpy.mockRestore()
    }
  })

  test('handleError', async () => {
    const command = createCommand(DeploymentCorrelateImageCommand)

    const requestError = getRequestError(400, {
      message: 'Request failed with status code 400',
      errors: ['Some validation error'],
    })

    command['handleError'](requestError)

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
