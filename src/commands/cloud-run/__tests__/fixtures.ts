import {Cli} from 'clipanion'

import {CloudRunFlareCommand} from '../flare'

export const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
    stderr: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

export const makeCli = () => {
  const cli = new Cli()
  cli.register(CloudRunFlareCommand)

  return cli
}
