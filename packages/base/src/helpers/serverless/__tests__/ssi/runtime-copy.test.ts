import {
  TRACER_COPY_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_READINESS_PORT,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  buildRuntimeCopyPlan,
  type RuntimeCopyOrderingStrategy,
  type RuntimeCopyRequest,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/runtime-copy'

const completionMarker = `${TRACER_MOUNT_PATH}/.dd-trace-rb-copy-finished`

const makeRequest = (overrides: Partial<RuntimeCopyRequest> = {}): RuntimeCopyRequest => ({
  image: 'gcr.io/datadoghq/dd-lib-ruby-init:latest',
  containerName: TRACER_COPY_CONTAINER_NAME,
  volumeName: TRACER_VOLUME_NAME,
  mountPath: TRACER_MOUNT_PATH,
  completionMarker,
  artifacts: [[`${TRACER_MOUNT_PATH}/auto_inject.rb`]],
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
    const artifacts: RuntimeCopyRequest['artifacts'] = [
      [`${TRACER_MOUNT_PATH}/primary.so`, `${TRACER_MOUNT_PATH}/fallback.so`],
      [`${TRACER_MOUNT_PATH}/manifest.json`],
    ]

    expect(buildRuntimeCopyPlan(makeRequest({artifacts}), {kind: 'ecs-success-dependency'}).artifacts).toEqual(
      artifacts
    )
  })
})
