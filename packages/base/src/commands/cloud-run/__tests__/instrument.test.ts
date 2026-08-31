import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {CloudRunInstrumentCommand} from '../instrument'

interface ParsedOptions {
  tracing: string | undefined
  language: string | undefined
  tracerVersion: string | undefined
  tracerLibc: string | undefined
  tracerVolumeMedium: string | undefined
  healthCheckPort: number | undefined
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
      tracerVolumeMedium: this.tracerVolumeMedium,
      healthCheckPort: this.healthCheckPort,
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
    const {code} = await runCLI([
      '--language',
      'rust',
      '--tracer-version',
      '2.0.0',
      '--tracer-libc',
      'musl',
      '--tracer-volume-medium',
      'disk',
    ])

    expect(code).toBe(0)
    expect(parsedOptions).toEqual({
      tracing: undefined,
      language: 'rust',
      tracerVersion: '2.0.0',
      tracerLibc: 'musl',
      tracerVolumeMedium: 'disk',
      healthCheckPort: undefined,
      tracerReadinessPort: 18999,
    })
  })

  test.each([1, 8127, 65535])('parses --health-check-port %s as a number', async (port) => {
    const {code} = await runCLI(['--health-check-port', String(port)])

    expect(code).toBe(0)
    expect(parsedOptions?.healthCheckPort).toBe(port)
  })

  test.each(['0', '65536', '8127.5', 'not-a-port'])('rejects invalid --health-check-port %s', async (port) => {
    const {code} = await runCLI(['--health-check-port', port])

    expect(code).toBe(1)
    expect(parsedOptions).toBeUndefined()
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
    ['--tracer-version', 'bad/tag'],
    ['--tracer-registry', 'gcr.io/datadoghq'],
    ['--tracer-libc', 'bionic'],
    ['--tracer-volume-medium', 'ramdisk'],
  ])('rejects %s %s', async (flag, value) => {
    const {code} = await runCLI([flag, value])

    expect(code).toBe(1)
    expect(parsedOptions).toBeUndefined()
  })
})
