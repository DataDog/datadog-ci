import type {EnvFragment, EnvFragmentGroup} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {EnvOps} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env-merge'

import {
  assertFragmentsCanBeMerged,
  hasAllFragments,
  mergeFragments,
  removeFragmentGroups,
  removeFragments,
  upsertEnv,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env-merge'

type Variable = {name: string; value?: string; secret?: boolean}

const ops = (env: readonly Variable[] = []): EnvOps<Variable> => ({
  matches: (variable, name) => variable.name === name,
  valueOf: (variable) => (variable.secret ? undefined : variable.value),
  isSecretBacked: (name) => env.some((variable) => variable.name === name && variable.secret === true),
  create: (name, value) => ({name, value}),
  withValue: (variable, value) => ({...variable, value}),
})

const NODE_OPTIONS: EnvFragment = {
  name: 'NODE_OPTIONS',
  value: '--require /datadog-lib/node_modules/dd-trace/init.js',
  separator: ' ',
  mode: 'append',
}
const PROFILING: EnvFragment = {name: 'CORECLR_ENABLE_PROFILING', value: '1', mode: 'set-if-absent'}
const TRACER_HOME: EnvFragment = {name: 'DD_DOTNET_TRACER_HOME', value: '/datadog-lib', mode: 'set-if-absent'}

describe('environment entries', () => {
  test('adds a variable the container does not declare', () => {
    expect(upsertEnv([{name: 'PORT', value: '8080'}], 'DD_ENV', 'prod', ops())).toEqual([
      {name: 'PORT', value: '8080'},
      {name: 'DD_ENV', value: 'prod'},
    ])
  })

  test('replaces a variable in place, keeping the rest of the entry', () => {
    expect(upsertEnv([{name: 'DD_ENV', value: 'dev', secret: false}], 'DD_ENV', 'prod', ops())).toEqual([
      {name: 'DD_ENV', value: 'prod', secret: false},
    ])
  })
})

describe('merging owned fragments', () => {
  test('adds each fragment once, keeping what the customer set', () => {
    const merged = mergeFragments([{name: 'NODE_OPTIONS', value: '--inspect'}], [NODE_OPTIONS], [], ops())

    expect(merged).toEqual([{name: 'NODE_OPTIONS', value: `--inspect ${NODE_OPTIONS.value}`}])
    expect(mergeFragments(merged, [NODE_OPTIONS], [], ops())).toEqual(merged)
    expect(hasAllFragments(merged, [NODE_OPTIONS], ops())).toBe(true)
  })

  test('rejects a name the container declares twice', () => {
    const env: Variable[] = [
      {name: 'NODE_OPTIONS', value: '--inspect'},
      {name: 'NODE_OPTIONS', value: '--trace-warnings'},
    ]

    expect(() => assertFragmentsCanBeMerged(env, [NODE_OPTIONS], [], ops(env))).toThrow('appears more than once')
  })

  test('rejects a name that resolves from a secret', () => {
    const env: Variable[] = [{name: 'NODE_OPTIONS', secret: true}]

    expect(() => assertFragmentsCanBeMerged(env, [NODE_OPTIONS], [], ops(env))).toThrow('secret reference')
  })

  test('rejects a name outside the fragments when it is named as well', () => {
    const env: Variable[] = [{name: 'DD_TAGS', secret: true}]

    expect(() => assertFragmentsCanBeMerged(env, [NODE_OPTIONS], ['DD_TAGS'], ops(env))).toThrow('secret reference')
  })
})

describe('removing owned fragments', () => {
  test('takes out the exact fragment and leaves the rest of the value', () => {
    expect(
      removeFragments([{name: 'NODE_OPTIONS', value: `--inspect ${NODE_OPTIONS.value}`}], [NODE_OPTIONS], ops())
    ).toEqual([{name: 'NODE_OPTIONS', value: '--inspect'}])
  })

  test('drops a variable the fragment emptied', () => {
    expect(removeFragments([{name: 'NODE_OPTIONS', value: NODE_OPTIONS.value}], [NODE_OPTIONS], ops())).toEqual([])
  })

  test('leaves a secret-backed variable alone', () => {
    const env: Variable[] = [{name: 'NODE_OPTIONS', secret: true}]

    expect(removeFragments(env, [NODE_OPTIONS], ops(env))).toEqual(env)
  })
})

describe('removing an injection variant', () => {
  const group: EnvFragmentGroup = {identifying: [TRACER_HOME], shared: [PROFILING]}

  test('keeps the shared settings a manual install would have written', () => {
    const manual: Variable[] = [
      {name: 'CORECLR_ENABLE_PROFILING', value: '1'},
      {name: 'DD_DOTNET_TRACER_HOME', value: '/opt/datadog'},
    ]

    expect(removeFragmentGroups(manual, [group], ops(manual))).toEqual(manual)
  })

  test('removes them once an identifying fragment shows instrumentation wrote them', () => {
    const injected: Variable[] = [
      {name: 'CORECLR_ENABLE_PROFILING', value: '1'},
      {name: 'DD_DOTNET_TRACER_HOME', value: '/datadog-lib'},
    ]

    expect(removeFragmentGroups(injected, [group], ops(injected))).toEqual([])
  })

  test('does not let one variant justify removing another', () => {
    const env: Variable[] = [
      {name: 'CORECLR_ENABLE_PROFILING', value: '1'},
      {name: 'NODE_OPTIONS', value: NODE_OPTIONS.value},
    ]

    expect(removeFragmentGroups(env, [group, {identifying: [NODE_OPTIONS], shared: []}], ops(env))).toEqual([
      {name: 'CORECLR_ENABLE_PROFILING', value: '1'},
    ])
  })
})
