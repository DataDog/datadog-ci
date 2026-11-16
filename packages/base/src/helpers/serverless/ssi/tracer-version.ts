import type {TracerRegistry} from './tracer'

import {getProxyDispatcher, httpRequest, isRequestError} from '../../request'
import {thirdParty} from '../../request/third-party'

import {DEFAULT_TRACER_VERSION, TRACER_REGISTRIES} from './tracer'

const MANIFEST_MEDIA_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')
const REQUEST_TIMEOUT_MS = 10_000

/** Where each registry issues the anonymous pull token its manifest API requires, if it requires one. */
const ANONYMOUS_TOKEN_URLS: Record<TracerRegistry, ((repository: string) => string) | undefined> = {
  'gcr.io/datadoghq': undefined,
  'public.ecr.aws/datadog': (repository) =>
    `https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository:${repository}:pull`,
  'datadoghq.azurecr.io': (repository) =>
    `https://datadoghq.azurecr.io/oauth2/token?service=datadoghq.azurecr.io&scope=repository:${repository}:pull`,
}

export type TracerVersionCheck =
  | {kind: 'ok'}
  | {kind: 'not-found'; message: string}
  | {kind: 'unverified'; message: string}

/**
 * Confirms that a pinned single-language tracer image exists before any resource changes, so a
 * version that was never published fails here instead of in a revision that cannot start.
 * Only a 404 for the manifest means the version does not exist; any other failure is `unverified`.
 */
export const checkPinnedTracerVersion = async (config: {
  kind: string
  spec?: {image: string}
}): Promise<TracerVersionCheck> => {
  const image = config.kind === 'single-language' ? config.spec?.image : undefined
  const separator = image?.lastIndexOf(':') ?? -1
  const version = image?.slice(separator + 1)
  const registry = TRACER_REGISTRIES.find((candidate) => image?.startsWith(`${candidate}/`))
  if (!image || !version || version === DEFAULT_TRACER_VERSION || !registry) {
    return {kind: 'ok'}
  }

  const imageName = image.slice(0, separator)
  try {
    return (await manifestExists(registry, imageName.slice(imageName.indexOf('/') + 1), version))
      ? {kind: 'ok'}
      : {
          kind: 'not-found',
          message: `Tracer version ${version} was not found in ${imageName}. Set --tracer-version to a published version.`,
        }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    return {
      kind: 'unverified',
      message: `Could not verify that tracer version ${version} exists in ${imageName}: ${reason}. Continuing without the check.`,
    }
  }
}

const manifestExists = async (registry: TracerRegistry, repository: string, version: string): Promise<boolean> => {
  const host = registry.split('/')[0]
  const tokenUrl = ANONYMOUS_TOKEN_URLS[registry]?.(repository)
  const token = tokenUrl ? await fetchAnonymousToken(tokenUrl) : undefined
  try {
    await httpRequest({
      method: 'HEAD',
      url: thirdParty(`https://${host}/v2/${repository}/manifests/${version}`),
      headers: {Accept: MANIFEST_MEDIA_TYPES, Authorization: token ? `Bearer ${token}` : undefined},
      dispatcher: getProxyDispatcher(),
      timeout: REQUEST_TIMEOUT_MS,
    })

    return true
  } catch (error) {
    if (isRequestError(error) && error.response?.status === 404) {
      return false
    }
    throw error
  }
}

const fetchAnonymousToken = async (url: string): Promise<string> => {
  const {data} = await httpRequest<{token?: string; access_token?: string}>({
    method: 'GET',
    url: thirdParty(url),
    dispatcher: getProxyDispatcher(),
    timeout: REQUEST_TIMEOUT_MS,
  })
  const token = data.token ?? data.access_token
  if (!token) {
    throw new Error('the registry returned no anonymous pull token')
  }

  return token
}
