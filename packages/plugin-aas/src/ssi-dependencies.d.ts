declare module 'tar-stream' {
  import type {Readable, Writable} from 'node:stream'

  export interface Headers {
    name: string
    type?: string
    linkname?: string
    mode?: number
  }

  export type Extract = Writable & {
    on(event: 'entry', listener: (header: Headers, stream: Readable, next: () => void) => void): Extract
    on(event: 'error', listener: (error: Error) => void): Extract
    on(event: 'finish', listener: () => void): Extract
  }

  export const extract: () => Extract
}
