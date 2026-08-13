import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {CloudRunInstrumentCommand} from '../instrument'

interface ParsedOptions {
  tracing: string | undefined
  language: string | undefined
  tracerVersion: string | undefined
  tracerLibc: string | undefined
  tracerReadinessPort: number
}

let parsedOptions: ParsedOptions | undefined

class TestCloudRunInstrumentCommand extends CloudRunInstrumentCommand {
  public async execute(): Promise<number> {
    parsedOptions = {
      tracing: this.tracing,
      language: this.language,
      tracerVersion: this.tracerVersion,
      tracerLibc: this.tracerLibc,
      tracerReadinessPort: this.tracerReadinessPort,
    }

    return 0
  }
}

const runCLI = makeRunCLI(TestCloudRunInstrumentCommand, ['cloud-run', 'instrument'])

describe('CloudRunInstrumentCommand', () => {
  beforeEach(() => {
    parsedOptions = undefined
  })

  test.each(['true', '1', 'manual', 'false', '0', 'disabled', 'inject'])('accepts --tracing %s', async (tracing) => {
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
      tracerReadinessPort: 18999,
    })
  })

  test.each([
    [[], 18999],
    [['--tracer-readiness-port', '1024'], 1024],
    [['--tracer-readiness-port', '19000'], 19000],
  ])('parses --tracer-readiness-port as a number', async (flags, expectedPort) => {
    const {code} = await runCLI(flags)

    expect(code).toBe(0)
    expect(parsedOptions?.tracerReadinessPort).toBe(expectedPort)
  })

  test.each(['0', '1023', '65536', '18999.5', 'not-a-port'])(
    'rejects invalid --tracer-readiness-port %s',
    async (port) => {
      const {code} = await runCLI(['--tracer-readiness-port', port])

      expect(code).toBe(1)
      expect(parsedOptions).toBeUndefined()
    }
  )

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
