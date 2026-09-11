import type {KuduClient} from './kudu'
import type {LanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

import {getProxyDispatcher, httpRequest} from '@datadog/datadog-ci-base/helpers/request'
import {thirdParty} from '@datadog/datadog-ci-base/helpers/request/third-party'

import {
  OCI_INDEX_MEDIA_TYPE,
  OCI_MANIFEST_MEDIA_TYPE,
  buildFleetPackageZip,
  getFleetRepository,
  resolveFleetPackage,
  selectFleetManifest,
  verifySha256,
  type AasCodeRuntime,
} from './ssi'
import {getAasInjectionSpec, getStagedRoot} from './ssi-env'

const FLEET_REGISTRY = 'https://install.datadoghq.com/v2'

export interface AasTracerStaging {
  readonly root: string
  readonly spec: LanguageInjectionSpec
  publish(kudu: KuduClient): Promise<void>
}

// Resolution performs no app mutation, so callers can validate environment conflicts against
// `root` before publishing anything to the app.
export const resolveAasTracerStaging = async (runtime: AasCodeRuntime): Promise<AasTracerStaging> => {
  const repository = getFleetRepository(runtime.language)
  const index = await fetchOciJson(`${FLEET_REGISTRY}/${repository}/manifests/latest`, OCI_INDEX_MEDIA_TYPE)
  const manifestDescriptor = selectFleetManifest(index)
  const manifestBytes = await fetchOciBytes(
    `${FLEET_REGISTRY}/${repository}/manifests/${manifestDescriptor.digest}`,
    OCI_MANIFEST_MEDIA_TYPE
  )
  verifySha256(manifestBytes, manifestDescriptor.digest)
  const fleetPackage = resolveFleetPackage(manifestDescriptor, JSON.parse(Buffer.from(manifestBytes).toString('utf8')))
  const root = getStagedRoot(runtime, fleetPackage.packageVersion, fleetPackage.manifestDigest)
  const spec = getAasInjectionSpec(runtime, root)

  return {
    root,
    spec,
    publish: async (kudu) => {
      if (await kudu.hasArtifacts(spec.artifacts)) {
        return
      }
      const layer = await httpRequest<Uint8Array>({
        method: 'GET',
        url: thirdParty(`${FLEET_REGISTRY}/${repository}/blobs/${fleetPackage.layer.digest}`),
        headers: {Accept: fleetPackage.layer.mediaType},
        responseType: 'arraybuffer',
        dispatcher: getProxyDispatcher(),
        timeout: 120_000,
      })
      const zip = await buildFleetPackageZip(layer.data, fleetPackage.layer.digest, runtime)
      await kudu.publish(root, zip)
      if (!(await kudu.hasArtifacts(spec.artifacts))) {
        throw new Error('The tracer staging deployment completed without all required startup files.')
      }
    },
  }
}

const fetchOciJson = async (url: string, accept: string): Promise<unknown> => {
  const bytes = await fetchOciBytes(url, accept)

  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

const fetchOciBytes = async (url: string, accept: string): Promise<Uint8Array> => {
  const {data} = await httpRequest<Uint8Array>({
    method: 'GET',
    url: thirdParty(url),
    headers: {Accept: accept},
    responseType: 'arraybuffer',
    dispatcher: getProxyDispatcher(),
    timeout: 120_000,
  })

  return data
}
