import type {IContainer} from '../types'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {resolveSsiConfig, selectIngressContainer, SsiConfigError, type SsiOptions} from '../ssi'

const baseFlags: SsiOptions = {
  apmEnabled: false,
  language: undefined,
  tracing: undefined,
  tracerVersion: 'latest',
  tracerRegistry: 'gcr.io/datadoghq',
  libc: 'glibc',
  tracerVolumeSize: '768Mi',
  tracerSidecarMemory: '1Gi',
}

const errorsFor = (overrides: Partial<SsiOptions>) => {
  const result = resolveSsiConfig({...baseFlags, ...overrides})

  return result.kind === 'errors' ? result.errors.join('\n') : ''
}

describe('resolveSsiConfig', () => {
  test('is disabled when APM is not requested', () => {
    expect(resolveSsiConfig({...baseFlags, language: 'nodejs'})).toEqual({kind: 'disabled', warnings: []})
    expect(errorsFor({tracerVersion: '1.2.3', libc: 'musl'})).toContain('--tracer-version, --libc')
  })

  test.each([
    [{apmEnabled: true}, '--language'],
    [{apmEnabled: true, language: 'nodejs', tracing: 'false'}, 'disabled tracing'],
    [{apmEnabled: true, language: 'nodejs', tracing: 'FALSE'}, 'disabled tracing'],
    [{apmEnabled: true, language: 'nodejs', tracing: '0'}, 'disabled tracing'],
    [{apmEnabled: true, language: 'ruby', libc: 'musl'}, 'musl'],
    [{apmEnabled: true, language: 'csharp', tracerVersion: '2.51.0'}, '2.51.0'],
  ] satisfies [Partial<SsiOptions>, string][])('rejects incompatible options %#', (options, message) => {
    expect(errorsFor(options)).toContain(message)
  })

  test('uses agent-only mode for Go and rejects tracer image flags', () => {
    const result = resolveSsiConfig({...baseFlags, apmEnabled: true, language: 'go'})
    expect(result.kind).toBe('agent-only')
    expect(result.warnings.join('\n')).toContain('dd-trace-go')
    expect(errorsFor({apmEnabled: true, language: 'go', tracerVersion: '1.2.3'})).toContain('--tracer-version')
  })

  test.each<[Language, string]>([
    ['java', 'java'],
    ['nodejs', 'js'],
    ['csharp', 'dotnet'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
  ])('resolves the %s tracer image', (language, tracerLanguage) => {
    const result = resolveSsiConfig({...baseFlags, apmEnabled: true, language})
    expect(result.kind).toBe('single-language')
    expect(result.kind === 'single-language' && result.spec.image).toBe(
      `gcr.io/datadoghq/dd-lib-${tracerLanguage}-init:latest`
    )
  })

  test('emits the Java warning', () => {
    expect(resolveSsiConfig({...baseFlags, apmEnabled: true, language: 'java'}).warnings.join('\n')).toContain(
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
    expect(() => selectIngressContainer([{name: 'datadog-sidecar'}], reserved)).toThrow(SsiConfigError)
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
