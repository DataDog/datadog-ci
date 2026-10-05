import type {ManagedTracerConfig, TracerArtifacts} from '@datadog/datadog-ci-base/helpers/serverless/ssi/recognition'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {COMPOSITE_TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  getInjectedTracer,
  getInjectionEnvGroups,
  getManagedTracerConfig,
  getManagedTracerMountPaths,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/recognition'

const REGISTRY = 'public.ecr.aws/datadog'

describe('tracer image recognition', () => {
  test.each<[Language, string]>([
    ['java', 'java'],
    ['nodejs', 'js'],
    ['csharp', 'dotnet'],
    ['python', 'python'],
    ['ruby', 'ruby'],
    ['php', 'php'],
  ])('recognizes the %s tracer image', (_, tracerLanguage) => {
    const config = getManagedTracerConfig(`${REGISTRY}/dd-lib-${tracerLanguage}-init:latest`, REGISTRY)

    expect(config?.mountPath).toBe(TRACER_MOUNT_PATH)
    // One per libc, since the image alone does not say which one was copied.
    expect(config?.envVariants).toHaveLength(2)
  })

  test('recognizes the composite image', () => {
    expect(getManagedTracerConfig(`${REGISTRY}/dd-lib-composite-init:latest`, REGISTRY)?.mountPath).toBe(
      COMPOSITE_TRACER_MOUNT_PATH
    )
  })

  test.each([
    undefined,
    'my-app:latest',
    'gcr.io/datadoghq/dd-lib-js-init:latest',
    `${REGISTRY}/dd-lib-js-init:`,
    `${REGISTRY}/dd-lib-rust-init:latest`,
  ])('does not recognize %s', (image) => {
    expect(getManagedTracerConfig(image, REGISTRY)).toBeUndefined()
  })

  test('owns both injection modes mount paths', () => {
    expect([...getManagedTracerMountPaths(REGISTRY)].sort()).toEqual(
      [TRACER_MOUNT_PATH, COMPOSITE_TRACER_MOUNT_PATH].sort()
    )
  })
})

describe('removable environment grouping', () => {
  const groups = getInjectionEnvGroups(REGISTRY)
  const named = (name: string) =>
    groups.flatMap((group) => [
      ...group.identifying.filter((fragment) => fragment.name === name).map(() => 'identifying'),
      ...group.shared.filter((fragment) => fragment.name === name).map(() => 'shared'),
    ])

  test.each(['NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', 'PYTHONPATH', 'RUBYOPT', 'PHP_INI_SCAN_DIR', 'LD_PRELOAD'])(
    'treats %s as written only by instrumentation',
    (name) => {
      expect(named(name)).not.toHaveLength(0)
      expect(new Set(named(name))).toEqual(new Set(['identifying']))
    }
  )

  // A manual tracer install sets these to the same values, so they carry no proof of who wrote them.
  test.each(['CORECLR_ENABLE_PROFILING', 'CORECLR_PROFILER', 'DD_INJECT_SENDER_TYPE'])(
    'treats %s as shared with a manual install',
    (name) => {
      expect(named(name)).not.toHaveLength(0)
      expect(new Set(named(name))).toEqual(new Set(['shared']))
    }
  )

  test('every group can prove itself', () => {
    for (const group of groups) {
      expect(group.identifying).not.toHaveLength(0)
    }
  })
})

describe('injected tracer artifacts', () => {
  const config: ManagedTracerConfig = {mountPath: TRACER_MOUNT_PATH, envVariants: []}
  const complete: TracerArtifacts = {
    tracers: [config],
    volumeCount: 1,
    mounts: [{index: 0, path: TRACER_MOUNT_PATH}],
  }

  test('accepts the single coherent set instrumentation writes', () => {
    expect(getInjectedTracer(complete, 0)).toBe(config)
  })

  test.each<[string, TracerArtifacts]>([
    ['no tracer container', {...complete, tracers: []}],
    ['two tracer containers', {...complete, tracers: [...complete.tracers, config]}],
    ['no tracer volume', {...complete, volumeCount: 0}],
    ['two tracer volumes', {...complete, volumeCount: 2}],
    ['no mount', {...complete, mounts: []}],
    ['two mounts', {...complete, mounts: [...complete.mounts, {index: 2, path: TRACER_MOUNT_PATH}]}],
    ['a mount at another path', {...complete, mounts: [{index: 0, path: '/elsewhere'}]}],
  ])('rejects %s', (_, artifacts) => {
    expect(getInjectedTracer(artifacts, 0)).toBeUndefined()
  })

  test('rejects a mount on a container other than the target', () => {
    expect(getInjectedTracer(complete, 2)).toBeUndefined()
  })
})
