import {createCommand, getAxiosError, makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {DeploymentCorrelateImageCommand} from '../correlate-image'

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
      DATADOG_API_KEY: 'fake-api-key',
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
    expect(output).toContain('"type": "ci_app_deployment_correlate_image"')
    expect(output).toContain('"attributes"')
    expect(output).toContain('"commit_sha": "abcdef"')
    expect(output).toContain('"repository_url": "https://github.com/DataDog/example"')
    expect(output).toContain('"image": "my-image:latest"')
  })

  test('handleError', async () => {
    const command = createCommand(DeploymentCorrelateImageCommand)

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
