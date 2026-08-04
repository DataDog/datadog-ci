import type {IContainer} from '../types'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {resolveSsiConfig, selectIngressContainer, SsiConfigError, type SsiOptions} from '../ssi'

const defaultOptions: SsiOptions = {
  language: undefined,
  tracing: undefined,
  tracerVersion: 'latest',
  tracerRegistry: 'gcr.io/datadoghq',
  tracerLibc: 'glibc',
  tracerVolumeSize: '768Mi',
  tracerSidecarMemory: '1Gi',
}

const getErrors = (overrides: Partial<SsiOptions>) => {
  const result = resolveSsiConfig({...defaultOptions, ...overrides})

  return result.kind === 'errors' ? result.errors.join('\n') : ''
}

describe('resolveSsiConfig', () => {
  test.each<[string, SsiOptions['tracing']]>([
    ['unset', undefined],
    ['manual', 'manual'],
    ['disabled', 'disabled'],
  ])('does not inject when tracing is %s', (_description, tracing) => {
    expect(resolveSsiConfig({...defaultOptions, tracing, language: 'nodejs'})).toEqual({
      kind: 'no-injection',
      warnings: [],
    })
  })

  test('requires injection for tracer flags', () => {
    expect(getErrors({tracerVersion: '1.2.3', tracerLibc: 'musl'})).toContain('--tracer-version, --tracer-libc')
  })

  test.each([
    [{tracing: 'inject'}, '--language'],
    [{tracing: 'inject', language: 'go'}, 'dd-trace-go'],
    [{tracing: 'inject', language: 'ruby', tracerLibc: 'musl'}, 'musl'],
    [{tracing: 'inject', language: 'csharp', tracerVersion: '2.51.0'}, '2.51.0'],
  ] satisfies [Partial<SsiOptions>, string][])('rejects incompatible options %#', (options, message) => {
    expect(getErrors(options)).toContain(message)
  })

  test.each<[Language, string]>([
    ['java', 'java'],
    ['nodejs', 'js'],
    ['csharp', 'dotnet'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
  ])('resolves the %s tracer image', (language, tracerLanguage) => {
    const result = resolveSsiConfig({...defaultOptions, tracing: 'inject', language})
    expect(result.kind).toBe('single-language')
    expect(result.kind === 'single-language' && result.spec.image).toBe(
      `gcr.io/datadoghq/dd-lib-${tracerLanguage}-init:latest`
    )
  })

  test('emits the Java warning', () => {
    expect(resolveSsiConfig({...defaultOptions, tracing: 'inject', language: 'java'}).warnings.join('\n')).toContain(
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
