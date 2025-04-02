import os from 'os'

import {Cli} from 'clipanion/lib/advanced'

import {createMockContext} from '../../../helpers/__tests__/fixtures'

import {UploadCommand} from '../upload'

describe('execute', () => {
  const runCLI = async (apiKey: string) => {
    const cli = makeCli()
    const context = createMockContext()
    if (apiKey !== '') {
      process.env = {DATADOG_API_KEY: apiKey}
    } else {
      process.env = {}
    }
    const code = await cli.run(['git-metadata', 'upload', '--dry-run'], context)

    return {context, code}
  }

  test('runCLI', async () => {
    const {code, context} = await runCLI('PLACEHOLDER')
    console.debug({stdout: context.stdout.toString(), stderr: context.stderr.toString()})

    const output = context.stdout.toString().split(os.EOL)
    output.reverse()
    expect(output[1]).toContain('[DRYRUN] Handled')
    expect(code).toBe(0)
  })

  test('runCLI without api key', async () => {
    const {code, context} = await runCLI('')
    console.debug({stdout: context.stdout.toString(), stderr: context.stderr.toString()})

    const output = context.stdout.toString().split(os.EOL)
    output.reverse()
    expect(output[1]).toContain('Missing DATADOG_API_KEY in your environment')
    expect(code).toBe(1)
  })
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadCommand)

  return cli
}
