import {Writable} from 'stream'

import {DefaultReporter} from './default'

export class DeferredReporter extends DefaultReporter {
  private buffer = ''

  constructor() {
    super({
      context: {
        stderr: process.stderr,
        stdout: new Writable({
          write: (chunk: Buffer, encoding, callback) => {
            this.buffer += chunk.toString()
            callback()
          },
        }),
      },
    })
  }

  public flush(): void {
    process.stdout.write('\n')
    process.stdout.write(this.buffer)
  }
}
