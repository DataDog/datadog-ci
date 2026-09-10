import type {KuduClient} from './kudu'

import {httpRequest} from '@datadog/datadog-ci-base/helpers/request'
import {thirdParty} from '@datadog/datadog-ci-base/helpers/request/third-party'
import {getLanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {buildFleetPackageZip, getFleetRepository, resolveFleetPackage, type AasCodeRuntime} from './ssi'
import {getStagedRoot} from './ssi-env'

const FLEET_REGISTRY = 'https://install.datadoghq.com/v2'

export const stageAasTracer = async (kudu: KuduClient, runtime: AasCodeRuntime): Promise<string> => {
  const repository = getFleetRepository(runtime.language)
  const index = await fetchOciJson(
    `${FLEET_REGISTRY}/${repository}/manifests/latest`,
    'application/vnd.oci.image.index.v1+json'
  )
  const manifestDigest = getAmd64Digest(index)
  const manifest = await fetchOciJson(
    `${FLEET_REGISTRY}/${repository}/manifests/${manifestDigest}`,
    'application/vnd.oci.image.manifest.v1+json'
  )
  const fleetPackage = resolveFleetPackage(index, manifest)
  const root = getStagedRoot(runtime, fleetPackage.packageVersion, fleetPackage.manifestDigest)
  const spec = getLanguageInjectionSpec({
    language: runtime.language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc: runtime.libc,
    root,
  })
  if (await kudu.hasArtifacts(spec.artifacts)) {
    return root
  }

  const layer = await httpRequest<Uint8Array>({
    method: 'GET',
    url: thirdParty(`${FLEET_REGISTRY}/${repository}/blobs/${fleetPackage.layer.digest}`),
    headers: {Accept: fleetPackage.layer.mediaType},
    responseType: 'arraybuffer',
    timeout: 120_000,
  })
  const zip = await buildFleetPackageZip(layer.data, fleetPackage.layer.digest, runtime)
  await kudu.publish(root, zip)
  if (!(await kudu.hasArtifacts(spec.artifacts))) {
    throw new Error('The tracer staging deployment completed without all required startup files.')
  }

  return root
}

const fetchOciJson = async (url: string, accept: string): Promise<unknown> =>
  (
    await httpRequest<unknown>({
      method: 'GET',
      url: thirdParty(url),
      headers: {Accept: accept},
      timeout: 120_000,
    })
  ).data

const getAmd64Digest = (index: unknown): string => {
  const manifests = (index as {manifests?: unknown[]}).manifests
  const descriptor = manifests?.find(
    (candidate): candidate is {digest?: unknown; platform?: {architecture?: unknown; os?: unknown}} =>
      typeof candidate === 'object' &&
      !!candidate &&
      (candidate as {platform?: {architecture?: unknown; os?: unknown}}).platform?.architecture === 'amd64' &&
      (candidate as {platform?: {architecture?: unknown; os?: unknown}}).platform?.os === 'linux'
  )
  if (typeof descriptor?.digest !== 'string') {
    throw new Error('The Fleet package index does not contain a Linux amd64 manifest.')
  }

  return descriptor.digest
}
