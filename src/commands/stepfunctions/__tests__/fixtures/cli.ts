import {Writable} from 'stream'

import type {CommandContext} from '../../../../helpers/interfaces'

export interface ContextFixture extends CommandContext {
  toString: () => string
}

export const contextFixture = (): ContextFixture => {
  let data = ''

  return {
    stdout: new Writable({
      write: (chunk, encoding, next) => {
        data += chunk.toString()
        next()
      },
    }),
    stderr: jest.fn() as any,
    toString: () => data,
  }
}
