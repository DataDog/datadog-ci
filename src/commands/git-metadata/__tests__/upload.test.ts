// tslint:disable: no-string-literal
import os from 'os'

import chalk from 'chalk'
import {Cli} from 'clipanion/lib/advanced'
import {UploadCommand} from '../upload'

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const command = new UploadCommand()

      expect(command['getRequestBuilder'].bind(command)).toThrow(
        `Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`
      )
    })
  })
})

describe('execute', () => {
  const runCLI = async () => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(['git-metadata', 'upload', '--dry-run'], context)

    return {context, code}
  }

  test('runCLI', async () => {
    const {code, context} = await runCLI()
    const output = context.stdout.toString().split(os.EOL)
    output.reverse()
    expect(output[1]).toContain('[DRYRUN] Handled')
    expect(code).toBe(0)
  })
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadCommand)

  return cli
}

const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}
