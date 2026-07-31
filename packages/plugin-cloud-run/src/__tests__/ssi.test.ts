import type {IContainer} from '../types'

import {
  cloudRunQuantityToBytes,
  selectIngressContainer,
  SsiValidationError,
  validateCloudRunQuantity,
  validateSsiFlags,
} from '../ssi'
const baseFlags = {
  apmEnabled: false,
  language: undefined as string | undefined,
  tracing: undefined as string | undefined,
  tracerVersion: 'latest',
  tracerRegistry: 'gcr.io/datadoghq',
  libc: 'glibc',
  tracerVolumeSize: '768Mi',
  tracerSidecarMemory: '1Gi',
}

const errorsFor = (overrides: Partial<typeof baseFlags>) => {
  const result = validateSsiFlags({...baseFlags, ...overrides})

  return result.kind === 'errors' ? result.errors.join('\n') : ''
}

describe('Cloud Run quantities', () => {
  test.each([
    ['512Mi', 512 * 1024 ** 2],
    ['1Gi', 1024 ** 3],
    ['0.5Gi', 0.5 * 1024 ** 3],
    ['256', 256],
  ])('parses %s', (value, bytes) => {
    expect(cloudRunQuantityToBytes(value)).toBe(bytes)
    expect(validateCloudRunQuantity(value, '--size')).toBe('')
  })

  test.each(['0', '0Mi', 'abc', '-1Gi', '1 Gi'])('rejects %s', (value) => {
    expect(cloudRunQuantityToBytes(value)).toBeUndefined()
    expect(validateCloudRunQuantity(value, '--size')).toContain('--size')
  })
})

describe('validateSsiFlags', () => {
  test('is disabled when APM is not requested', () => {
    expect(validateSsiFlags({...baseFlags, language: 'nodejs'})).toEqual({kind: 'disabled', warnings: []})
    expect(errorsFor({tracerVersion: '1.2.3', libc: 'musl'})).toContain('--tracer-version, --libc')
  })

  test.each([
    [{apmEnabled: true}, '--language'],
    [{apmEnabled: true, language: 'rust'}, 'rust'],
    [{apmEnabled: true, language: 'nodejs', tracing: 'false'}, '--tracing false'],
    [{apmEnabled: true, language: 'ruby', libc: 'musl'}, 'musl'],
    [{apmEnabled: true, language: 'csharp', tracerVersion: '2.51.0'}, '2.51.0'],
    [{apmEnabled: true, language: 'nodejs', tracerRegistry: 'example.com'}, 'example.com'],
    [{apmEnabled: true, language: 'nodejs', tracerVersion: 'v1/../evil'}, 'Invalid tracer version'],
  ])('rejects invalid options %#', (options, message) => {
    expect(errorsFor(options)).toContain(message)
  })

  test('uses agent-only mode for Go and rejects tracer image flags', () => {
    const result = validateSsiFlags({...baseFlags, apmEnabled: true, language: 'go'})
    expect(result.kind).toBe('go-agent-only')
    expect(result.warnings.join('\n')).toContain('dd-trace-go')
    expect(errorsFor({apmEnabled: true, language: 'go', tracerVersion: '1.2.3'})).toContain('--tracer-version')
  })

  test.each([
    ['java', 'java'],
    ['nodejs', 'js'],
    ['csharp', 'dotnet'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
  ])('resolves the %s tracer image', (language, canonical) => {
    const result = validateSsiFlags({...baseFlags, apmEnabled: true, language})
    expect(result.kind).toBe('single-language')
    expect(result.kind === 'single-language' && result.spec.image).toBe(
      `gcr.io/datadoghq/dd-lib-${canonical}-init:latest`
    )
  })

  test('validates volume sizing and emits the Java warning', () => {
    expect(errorsFor({apmEnabled: true, language: 'nodejs', tracerVolumeSize: 'bad'})).toContain('positive')
    expect(
      errorsFor({apmEnabled: true, language: 'nodejs', tracerVolumeSize: '1Gi', tracerSidecarMemory: '1000M'})
    ).toContain('cannot be smaller')
    expect(validateSsiFlags({...baseFlags, apmEnabled: true, language: 'java'}).warnings.join('\n')).toContain(
      'Java 24+'
    )
  })
})

describe('selectIngressContainer', () => {
  const reserved = new Set(['datadog-sidecar', 'datadog-tracer-copy'])

  test('selects the sole application port and ignores reserved and probe ports', () => {
    const containers: IContainer[] = [
      {name: 'worker', startupProbe: {tcpSocket: {port: 9000}}},
      {name: 'app', ports: [{containerPort: 8080}]},
      {name: 'datadog-sidecar', ports: [{containerPort: 8126}]},
    ]
    expect(selectIngressContainer(containers, reserved).name).toBe('app')
  })

  test('selects an unnamed ingress or the sole portless candidate', () => {
    expect(selectIngressContainer([{name: '', ports: [{containerPort: 8080}]}, {name: 'worker'}], reserved).name).toBe(
      ''
    )
    expect(selectIngressContainer([{name: 'app'}, {name: 'datadog-sidecar'}], reserved).name).toBe('app')
  })

  test('rejects missing and ambiguous ingress containers', () => {
    expect(() => selectIngressContainer([{name: 'datadog-sidecar'}], reserved)).toThrow(SsiValidationError)
    expect(() =>
      selectIngressContainer(
        [
          {name: 'app', ports: [{containerPort: 8080}]},
          {name: 'admin', ports: [{containerPort: 9090}]},
        ],
        reserved
      )
    ).toThrow(/app, admin/)
    expect(() => selectIngressContainer([{name: 'app'}, {name: 'worker'}], reserved)).toThrow(/app, worker/)
  })
})
