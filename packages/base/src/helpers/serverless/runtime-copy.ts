import path from 'node:path'

export type RuntimeCopyOrderingStrategy =
  | {kind: 'cloud-run-idling-sidecar'; readinessPort: number}
  | {kind: 'azure-container-app-init'}
  | {kind: 'ecs-success-dependency'}

export interface RuntimeCopyArtifactRequirement {
  anyOf: string[]
}

/** Absolute paths are data; shell adapters must pass them as quoted positional arguments, not interpolate them. */
export interface RuntimeCopyRequest {
  image: string
  containerName: string
  volumeName: string
  mountPath: string
  completionMarker: string
  artifacts: RuntimeCopyArtifactRequirement[]
  resources?: {memory?: string; cpu?: string}
}

export interface RuntimeCopyPlan extends RuntimeCopyRequest {
  ordering: RuntimeCopyOrderingStrategy
}

const validateNonEmpty = (value: string, description: string): void => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${description} must be a non-empty string`)
  }
}

const validateAbsolutePath = (value: string, description: string): void => {
  validateNonEmpty(value, description)
  if (!path.posix.isAbsolute(value)) {
    throw new Error(`${description} must be an absolute path`)
  }
  if (value.includes('\0')) {
    throw new Error(`${description} must not contain a null byte`)
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

const validateOrdering = (ordering: RuntimeCopyOrderingStrategy): RuntimeCopyOrderingStrategy => {
  switch (ordering.kind) {
    case 'cloud-run-idling-sidecar':
      if (!Number.isInteger(ordering.readinessPort) || ordering.readinessPort < 1 || ordering.readinessPort > 65535) {
        throw new Error('Cloud Run readiness port must be an integer from 1 to 65535')
      }

      return {...ordering}
    case 'azure-container-app-init':
    case 'ecs-success-dependency':
      return {...ordering}
    default:
      throw new Error(`Unsupported runtime-copy ordering strategy: ${String((ordering as {kind?: unknown}).kind)}`)
  }
}

export const buildRuntimeCopyPlan = (
  request: RuntimeCopyRequest,
  ordering: RuntimeCopyOrderingStrategy
): RuntimeCopyPlan => {
  validateNonEmpty(request.image, 'Runtime-copy image')
  validateNonEmpty(request.containerName, 'Runtime-copy container name')
  validateNonEmpty(request.volumeName, 'Runtime-copy volume name')
  validateAbsolutePath(request.mountPath, 'Runtime-copy mount path')
  validatePathBelowMount(request.completionMarker, 'Runtime-copy completion marker', request.mountPath)

  if (!Array.isArray(request.artifacts) || request.artifacts.length === 0) {
    throw new Error('Runtime-copy plan must have at least one artifact requirement')
  }

  const candidates = new Set<string>()
  const artifacts = request.artifacts.map((requirement, requirementIndex) => {
    if (!Array.isArray(requirement.anyOf) || requirement.anyOf.length === 0) {
      throw new Error(`Runtime-copy artifact requirement ${requirementIndex} must have at least one candidate`)
    }

    const anyOf = requirement.anyOf.map((candidate, candidateIndex) => {
      validatePathBelowMount(
        candidate,
        `Runtime-copy artifact candidate ${requirementIndex}:${candidateIndex}`,
        request.mountPath
      )
      const normalized = path.posix.normalize(candidate)
      if (candidates.has(normalized)) {
        throw new Error(`Duplicate runtime-copy artifact candidate: ${normalized}`)
      }
      candidates.add(normalized)

      return candidate
    })

    return {anyOf}
  })

  const plan: RuntimeCopyPlan = {
    image: request.image,
    containerName: request.containerName,
    volumeName: request.volumeName,
    mountPath: request.mountPath,
    completionMarker: request.completionMarker,
    artifacts,
    ordering: validateOrdering(ordering),
  }
  if (request.resources !== undefined) {
    plan.resources = {...request.resources}
  }

  return plan
}
