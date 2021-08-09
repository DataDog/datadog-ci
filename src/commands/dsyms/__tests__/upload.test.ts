// tslint:disable: no-string-literal
// tslint:disable: no-var-requires
import {Cli} from 'clipanion/lib/advanced'
import {EOL, platform} from 'os'

import {UploadCommand} from '../upload'

if (platform() !== 'darwin') {
  require('../utils').dwarfdumpUUID = jest.fn().mockResolvedValue(['BD8CE358-D5F3-358B-86DC-CBCF2148097B'])
}

describe('execute', () => {
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

  const runCLI = async (path: string) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(['dsyms', 'upload', path, '--dry-run'], context)

    return {context, code}
  }

  test('should succeed with folder input', async () => {
    const {context, code} = await runCLI('./src/commands/dsyms/__tests__/test files/')
    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)

    expect(outputString).not.toContain('Error')
    expect(code).toBe(0)
    expect(output[1]).toContain('Starting upload with concurrency 20. ')
    expect(output[2]).toContain('Will look for dSYMs in src/commands/dsyms/__tests__/test files/')
    expect(output[3]).toContain(
      'Uploading dSYM with BD8CE358-D5F3-358B-86DC-CBCF2148097B from src/commands/dsyms/__tests__/test files/test.dSYM'
    )
    expect(output[6]).toContain('Handled 1 dSYM with success in')
  })

  test('should succeed with zip file input', async () => {
    const {context, code} = await runCLI('./src/commands/dsyms/__tests__/test files/test.zip')
    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)

    expect(outputString).not.toContain('Error')
    expect(code).toBe(0)
    expect(output[1]).toContain('Starting upload with concurrency 20. ')
    expect(output[2]).toContain('Will look for dSYMs in src/commands/dsyms/__tests__/test files/test.zip')
    expect(output[3]).toContain('Uploading dSYM with BD8CE358-D5F3-358B-86DC-CBCF2148097B from /')
    expect(output[6]).toContain('Handled 1 dSYM with success in')
  })
})
