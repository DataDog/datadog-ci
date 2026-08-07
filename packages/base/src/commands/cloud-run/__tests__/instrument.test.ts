import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {CloudRunInstrumentCommand} from '../instrument'

interface ParsedOptions {
  tracing: string | undefined
  language: string | undefined
  tracerVersion: string | undefined
  tracerLibc: string | undefined
}

let parsedOptions: ParsedOptions | undefined

class TestCloudRunInstrumentCommand extends CloudRunInstrumentCommand {
  public async execute(): Promise<number> {
    parsedOptions = {
      tracing: this.tracing,
      language: this.language,
      tracerVersion: this.tracerVersion,
      tracerLibc: this.tracerLibc,
    }

    return 0
  }
}

const runCLI = makeRunCLI(TestCloudRunInstrumentCommand, ['cloud-run', 'instrument'])

describe('CloudRunInstrumentCommand', () => {
  beforeEach(() => {
    parsedOptions = undefined
  })

  test.each(['true', '1', 'manual', 'false', '0', 'inject'])('accepts --tracing %s', async (tracing) => {
    const {code} = await runCLI(['--tracing', tracing])

    expect(code).toBe(0)
    expect(parsedOptions?.tracing).toBe(tracing)
  })

  test('accepts automatic instrumentation options', async () => {
    const {code} = await runCLI(['--language', 'python', '--tracer-version', '2.0.0', '--tracer-libc', 'musl'])

    expect(code).toBe(0)
    expect(parsedOptions).toEqual({
      tracing: undefined,
      language: 'python',
      tracerVersion: '2.0.0',
      tracerLibc: 'musl',
    })
  })

  test.each([
    ['--tracing', 'automatic'],
    ['--language', 'rust'],
    ['--tracer-version', 'bad/tag'],
    ['--tracer-registry', 'gcr.io/datadoghq'],
    ['--tracer-libc', 'bionic'],
  ])('rejects %s %s', async (flag, value) => {
    const {code} = await runCLI([flag, value])

    expect(code).toBe(1)
    expect(parsedOptions).toBeUndefined()
  })
})
