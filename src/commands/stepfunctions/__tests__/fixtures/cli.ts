import {Readable, Writable} from 'stream'

import {BaseContext} from 'clipanion'

export interface testContext extends BaseContext {
  toString: () => string
}

export const contextFixture = (): testContext => {
  let data = ''

  return {
    stdin: new Readable(),
    stdout: new Writable({
      write: (chunk, encoding, next) => {
        data += chunk.toString()
        next()
      },
    }),
    stderr: new Writable(),
    toString: () => data,
  }
}
