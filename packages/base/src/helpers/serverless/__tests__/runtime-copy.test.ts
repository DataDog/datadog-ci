import {
  TRACER_COPY_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_READINESS_PORT,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  buildRuntimeCopyPlan,
  type RuntimeCopyOrderingStrategy,
  type RuntimeCopyRequest,
} from '@datadog/datadog-ci-base/helpers/serverless/runtime-copy'

const completionMarker = `${TRACER_MOUNT_PATH}/.dd-trace-rb-copy-finished`

const makeRequest = (overrides: Partial<RuntimeCopyRequest> = {}): RuntimeCopyRequest => ({
  image: 'gcr.io/datadoghq/dd-lib-ruby-init:latest',
  containerName: TRACER_COPY_CONTAINER_NAME,
  volumeName: TRACER_VOLUME_NAME,
  mountPath: TRACER_MOUNT_PATH,
  completionMarker,
  artifacts: [{anyOf: [`${TRACER_MOUNT_PATH}/auto_inject.rb`, `${TRACER_MOUNT_PATH}/host_inject.rb`]}],
  ...overrides,
})

describe('buildRuntimeCopyPlan', () => {
  test.each<RuntimeCopyOrderingStrategy>([
    {kind: 'cloud-run-idling-sidecar', readinessPort: TRACER_READINESS_PORT},
    {kind: 'azure-container-app-init'},
    {kind: 'ecs-success-dependency'},
  ])('preserves the $kind ordering descriptor', (ordering) => {
    expect(buildRuntimeCopyPlan(makeRequest(), ordering).ordering).toEqual(ordering)
  })

  test('preserves image-neutral copy inputs and optional resources', () => {
    const request = makeRequest({resources: {memory: '256Mi', cpu: '1'}})

    expect(buildRuntimeCopyPlan(request, {kind: 'azure-container-app-init'})).toEqual({
      image: request.image,
      containerName: request.containerName,
      volumeName: request.volumeName,
      mountPath: request.mountPath,
      completionMarker: request.completionMarker,
      artifacts: request.artifacts,
      resources: {memory: '256Mi', cpu: '1'},
      ordering: {kind: 'azure-container-app-init'},
    })
  })

  test('models all required artifact groups with alternatives', () => {
    const artifacts = [
      {anyOf: [`${TRACER_MOUNT_PATH}/auto_inject.rb`, `${TRACER_MOUNT_PATH}/host_inject.rb`]},
      {anyOf: [`${TRACER_MOUNT_PATH}/manifest.json`]},
    ]

    expect(buildRuntimeCopyPlan(makeRequest({artifacts}), {kind: 'ecs-success-dependency'}).artifacts).toEqual(
      artifacts
    )
  })

  test('preserves legal absolute path values as adapter data', () => {
    const request = makeRequest({
      mountPath: `${TRACER_MOUNT_PATH}/./`,
      completionMarker: `${TRACER_MOUNT_PATH}//.copy marker;$(ignored)`,
      artifacts: [{anyOf: [`${TRACER_MOUNT_PATH}/nested/../tracer file;$(ignored)`]}],
    })

    const plan = buildRuntimeCopyPlan(request, {kind: 'azure-container-app-init'})

    expect(plan.mountPath).toBe(request.mountPath)
    expect(plan.completionMarker).toBe(request.completionMarker)
    expect(plan.artifacts).toEqual(request.artifacts)
  })

  test.each([
    ['image', {image: ' '}],
    ['container name', {containerName: ''}],
    ['volume name', {volumeName: ' '}],
  ] as const)('rejects an empty %s', (_description, override) => {
    expect(() => buildRuntimeCopyPlan(makeRequest(override), {kind: 'azure-container-app-init'})).toThrow(
      'must be a non-empty string'
    )
  })

  test('rejects a relative mount path', () => {
    expect(() =>
      buildRuntimeCopyPlan(makeRequest({mountPath: 'relative'}), {
        kind: 'azure-container-app-init',
      })
    ).toThrow('must be an absolute path')
  })

  test.each<[string, Partial<RuntimeCopyRequest>]>([
    ['completion marker', {completionMarker: '/tmp/copy-finished'}],
    ['artifact candidate', {artifacts: [{anyOf: ['/tmp/tracer']}]}],
    ['traversing artifact candidate', {artifacts: [{anyOf: [`${TRACER_MOUNT_PATH}/../tmp/tracer`]}]}],
  ])('rejects a %s outside the mount', (_description, override) => {
    expect(() => buildRuntimeCopyPlan(makeRequest(override), {kind: 'ecs-success-dependency'})).toThrow(
      'must be below mount path'
    )
  })

  test('rejects an empty artifact requirement list', () => {
    expect(() => buildRuntimeCopyPlan(makeRequest({artifacts: []}), {kind: 'azure-container-app-init'})).toThrow(
      'must have at least one artifact requirement'
    )
  })

  test('rejects an empty artifact candidate group', () => {
    expect(() =>
      buildRuntimeCopyPlan(makeRequest({artifacts: [{anyOf: []}]}), {kind: 'azure-container-app-init'})
    ).toThrow('must have at least one candidate')
  })

  test('rejects duplicate normalized candidates', () => {
    expect(() =>
      buildRuntimeCopyPlan(
        makeRequest({
          artifacts: [{anyOf: [`${TRACER_MOUNT_PATH}/tracer`]}, {anyOf: [`${TRACER_MOUNT_PATH}//tracer`]}],
        }),
        {kind: 'ecs-success-dependency'}
      )
    ).toThrow('Duplicate runtime-copy artifact candidate')
  })

  test.each([0, -1, 1.5, Number.NaN, 65536])('rejects invalid Cloud Run readiness port %p', (readinessPort) => {
    expect(() => buildRuntimeCopyPlan(makeRequest(), {kind: 'cloud-run-idling-sidecar', readinessPort})).toThrow(
      'must be an integer from 1 to 65535'
    )
  })

  test.each([1, 65535])('accepts Cloud Run readiness port %p', (readinessPort) => {
    expect(buildRuntimeCopyPlan(makeRequest(), {kind: 'cloud-run-idling-sidecar', readinessPort}).ordering).toEqual({
      kind: 'cloud-run-idling-sidecar',
      readinessPort,
    })
  })

  test('does not copy adversarial request properties into the plan', () => {
    const request = Object.assign(makeRequest(), {
      env: {SECRET: 'value'},
      containers: ['application'],
      volumes: ['application'],
      service: {platform: 'cloud-run'},
    })

    const plan = buildRuntimeCopyPlan(request, {kind: 'azure-container-app-init'})

    expect(plan).not.toHaveProperty('env')
    expect(plan).not.toHaveProperty('containers')
    expect(plan).not.toHaveProperty('volumes')
    expect(plan).not.toHaveProperty('service')
  })
})
