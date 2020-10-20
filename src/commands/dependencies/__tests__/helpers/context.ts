import {BaseContext} from 'clipanion/lib/advanced'
import {Readable, Writable} from 'stream'

interface WritableToString extends Writable {
  toString(): string
}

export interface MockContext extends BaseContext {
  stderr: WritableToString
  stdout: WritableToString
}

export const createMockContext = (): MockContext => {
  const buffer = {
    stderr: [] as string[],
    stdout: [] as string[],
  }

  const stderr = new Writable({
    write(chunk, encoding, callback) {
      buffer.stderr.push(chunk)
      callback()
    },
  })
  const stdout = new Writable({
    write(chunk, encoding, callback) {
      buffer.stdout.push(chunk)
      callback()
    },
  })
  const stdin = new Readable()

  Object.assign(stderr, {toString: () => buffer.stderr.join('')})
  Object.assign(stdout, {toString: () => buffer.stdout.join('')})

  return {
    stderr,
    stdin,
    stdout,
  }
}
