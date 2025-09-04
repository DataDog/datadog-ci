import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {UploadCommand} from '../upload'

describe('execute', () => {
  const runCLI = makeRunCLI(UploadCommand, ['git-metadata', 'upload', '--dry-run'])

  test('runCLI', async () => {
    const {code, context} = await runCLI([], {DATADOG_API_KEY: 'PLACEHOLDER'})
    const output = context.stdout.toString().split('\n')
    output.reverse()
    expect(output[1]).toContain('[DRYRUN] Handled')
    expect(code).toBe(0)
  })

  test('runCLI without api key', async () => {
    const {code, context} = await runCLI([], {DATADOG_API_KEY: ''})
    const output = context.stdout.toString().split('\n')
    output.reverse()
    expect(output[1]).toContain('Missing DD_API_KEY in your environment')
    expect(code).toBe(1)
  })
})
