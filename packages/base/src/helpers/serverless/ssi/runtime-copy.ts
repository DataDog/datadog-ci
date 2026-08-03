import path from 'node:path'

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
): RuntimeCopyPlan => {
  validateMountPath(request.mountPath)
  validatePathBelowMount(request.completionMarker, 'Runtime-copy completion marker', request.mountPath)
  request.artifacts
    .flat()
    .forEach((artifact) => validatePathBelowMount(artifact, 'Runtime-copy artifact', request.mountPath))

  return {...request, ordering}
}

const validateMountPath = (value: string): void => {
  validateAbsolutePath(value, 'Runtime-copy mount path')
  if (value.split('/').includes('..')) {
    throw new Error('Runtime-copy mount path must not contain parent traversal')
  }
}

const validatePathBelowMount = (value: string, description: string, mountPath: string): void => {
  validateAbsolutePath(value, description)
  const normalized = path.posix.normalize(value)
  const normalizedMountPath = path.posix.normalize(mountPath).replace(/\/$/, '') || '/'
  const isBelowMount =
    normalizedMountPath === '/' ? normalized !== '/' : normalized.startsWith(`${normalizedMountPath}/`)
  if (!isBelowMount) {
    throw new Error(`${description} must be below mount path ${mountPath}`)
  }
}

const validateAbsolutePath = (value: string, description: string): void => {
  if (!path.posix.isAbsolute(value)) {
    throw new Error(`${description} must be an absolute path`)
  }
}
