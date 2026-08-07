import type {RequiredArtifact} from './injection-spec'

export type RuntimeCopyOrderingStrategy =
  | {kind: 'cloud-run-idling-sidecar'; readinessPort: number}
  | {kind: 'azure-container-app-init'}
  | {kind: 'ecs-success-dependency'}

/** Shell adapters must pass paths as quoted arguments, never interpolate them. */
export interface RuntimeCopyRequest {
  image: string
  containerName: string
  volumeName: string
  mountPath: string
  completionMarker: string
  artifacts: readonly [RequiredArtifact, ...RequiredArtifact[]]
  resources?: {memory?: string; cpu?: string}
}

export interface RuntimeCopyPlan extends RuntimeCopyRequest {
  ordering: RuntimeCopyOrderingStrategy
}

export const buildRuntimeCopyPlan = (
  request: RuntimeCopyRequest,
  ordering: RuntimeCopyOrderingStrategy
): RuntimeCopyPlan => ({...request, ordering})
