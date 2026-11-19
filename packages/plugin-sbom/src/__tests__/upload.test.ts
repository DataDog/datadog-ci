import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as requestModule from '@datadog/datadog-ci-base/helpers/request'

import {PluginCommand as SbomUploadCommand} from '../commands/upload'

// Mock context for CI event validation tests with compatible write signatures
// We care about stdout vs stderr for validating warning messages
const createSimpleMockContext = () => {
  let stdoutData = ''
  let stderrData = ''

  return {
    stdout: {
      toString: () => stdoutData,
      write: (input?: string) => {
        if (input) {
          stdoutData += input
        }
      },
    },
    stderr: {
      toString: () => stderrData,
      write: (input?: string) => {
        if (input) {
          stderrData += input
        }
      },
    },
  }
}

describe('execute', () => {
  describe('CI event validation', () => {
    test('should exit with error for GitHub pull_request event', async () => {
      const originalEnv = {...process.env}
      process.env.GITHUB_EVENT_NAME = 'pull_request'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        const code = await command.execute()
        const output = context.stdout.toString()

        expect(code).toBe(1)
        expect(output).toContain('::error title=Unsupported Trigger::')
        expect(output).toContain(
          'The `pull_request` event is not supported by Datadog Code Security and will cause issues with the product'
        )
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should exit with error for GitLab merge_request_event', async () => {
      const originalEnv = {...process.env}
      process.env.CI_PIPELINE_SOURCE = 'merge_request_event'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        const code = await command.execute()
        const output = context.stderr.toString()

        expect(code).toBe(1)
        expect(output).toContain(
          'The `merge_request_event` pipeline source is not supported by Datadog Code Security and will cause issues with the product'
        )
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should exit with error for Azure PullRequest event', async () => {
      const originalEnv = {...process.env}
      process.env.BUILD_REASON = 'PullRequest'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        const code = await command.execute()
        const output = context.stdout.toString()

        expect(code).toBe(1)
        expect(output).toContain('##vso[task.logissue type=error]')
        expect(output).toContain(
          'The `PullRequest` build reason is not supported by Datadog Code Security and will cause issues with the product'
        )
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })
  })

  describe('credentials', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
      originalEnv = {...process.env}
      for (const name of [
        'GITHUB_EVENT_NAME',
        'CI_PIPELINE_SOURCE',
        'BUILD_REASON',
        'DATADOG_API_KEY',
        'DD_API_KEY',
        'DATADOG_APP_KEY',
        'DD_APP_KEY',
        'DATADOG_ACCESS_TOKEN',
        'DD_ACCESS_TOKEN',
      ]) {
        delete process.env[name]
      }
    })

    afterEach(() => {
      process.env = originalEnv
      jest.restoreAllMocks()
    })

    test('should explain that an API key alone is not enough', async () => {
      process.env.DD_API_KEY = 'intake-api-key'
      const httpRequestSpy = jest.spyOn(requestModule, 'httpRequest')

      const context = createSimpleMockContext()
      const command = createCommand(SbomUploadCommand, context)
      command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

      const code = await command.execute()
      const output = context.stderr.toString()

      expect(code).toBe(1)
      expect(output).toContain(
        '`sbom upload` needs an application key (DD_APP_KEY) or an access token (DD_ACCESS_TOKEN)'
      )
      expect(output).toContain('An intake mapping only provides an API key')
      expect(output).toContain('identity mapping')
      expect(httpRequestSpy).not.toHaveBeenCalled()
    })

    test('should upload with only an access token, sent as a bearer token', async () => {
      process.env.DD_ACCESS_TOKEN = 'access-token'
      const httpRequestSpy = jest
        .spyOn(requestModule, 'httpRequest')
        .mockResolvedValue({config: {}, data: {}, headers: {}, status: 200, statusText: 'OK'})

      const context = createSimpleMockContext()
      const command = createCommand(SbomUploadCommand, context)
      command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

      const code = await command.execute()

      expect(context.stderr.toString()).toBe('')
      expect(code).toBe(0)
      expect(httpRequestSpy).toHaveBeenCalledTimes(1)
      const headers = httpRequestSpy.mock.calls[0][0].headers
      expect(headers).toMatchObject({Authorization: 'Bearer access-token'})
      expect(headers).not.toHaveProperty('DD-API-KEY')
      expect(headers).not.toHaveProperty('DD-APPLICATION-KEY')
    })
  })
})
