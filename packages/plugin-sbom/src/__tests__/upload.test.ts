import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

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
    test('should show warning for GitHub pull_request event', async () => {
      const originalEnv = {...process.env}
      process.env.GITHUB_EVENT_NAME = 'pull_request'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        await command.execute()
        const output = context.stdout.toString()

        expect(output).toContain('::warning title=Unsupported Trigger::')
        expect(output).toContain('The `pull_request` event will become unsupported in the next release')
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should show warning for GitLab merge_request_event', async () => {
      const originalEnv = {...process.env}
      process.env.CI_PIPELINE_SOURCE = 'merge_request_event'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        await command.execute()
        const output = context.stderr.toString()

        expect(output).toContain(
          'The `merge_request_event` pipeline source will become unsupported in the next release'
        )
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should show warning for Azure PullRequest event', async () => {
      const originalEnv = {...process.env}
      process.env.BUILD_REASON = 'PullRequest'
      process.env.DATADOG_API_KEY = 'fake-api-key'
      process.env.DATADOG_APP_KEY = 'fake-app-key'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SbomUploadCommand, context)
        command['basePath'] = './src/__tests__/fixtures/sbom-python.json'

        await command.execute()
        const output = context.stdout.toString()

        expect(output).toContain('##vso[task.logissue type=warning]')
        expect(output).toContain('The `PullRequest` build reason will become unsupported in the next release')
        expect(output).toContain('To continue using Datadog Code Security, use `push` instead')
      } finally {
        process.env = originalEnv
      }
    })
  })
})
