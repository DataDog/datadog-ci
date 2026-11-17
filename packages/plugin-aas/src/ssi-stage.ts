import {randomBytes} from 'node:crypto'

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
import {AAS_SSI_STAGING_ROOT, getAasInjectionSpec, getStagedRoot} from './ssi-env'

const FLEET_REGISTRY = 'https://install.datadoghq.com/v2'
// A run uploads its temporary tree within minutes, so a tree this old belongs to no running staging.
const LEFTOVER_MIN_AGE_MINUTES = 30

export interface AasTracerStaging {
  readonly root: string
  readonly spec: LanguageInjectionSpec
  /** Publishes the tracer unless already staged. Returns whether anything was uploaded. */
  publish(kudu: KuduClient, warn: (message: string) => void): Promise<boolean>
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
    publish: async (kudu, warn) => {
      const removeLeftovers = async () => {
        await removeTemporaryTrees(kudu, root, warn, LEFTOVER_MIN_AGE_MINUTES)
        await removeTemporaryTrees(kudu, AAS_SSI_STAGING_ROOT, warn, LEFTOVER_MIN_AGE_MINUTES)
      }
      // This check also waits for the SCM site to be ready before anything is uploaded.
      if (await kudu.hasArtifacts(spec.artifacts)) {
        await removeLeftovers()

        return false
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
      // Extraction continues on the Web App after the CLI exits, so an interrupted run can leave a
      // partial tree. Extract to a temporary sibling and rename it into place, which is atomic on
      // the /home mount, so `root` only ever holds a complete tree.
      const temporaryRoot = temporaryPath(root)
      await kudu.publish(temporaryRoot, zip)
      // The Azure Files-backed /home mount can lag on file enumeration right after extraction
      // (CIFS), so wait for the startup files before declaring the deploy incomplete.
      if (!(await kudu.hasArtifacts(getAasInjectionSpec(runtime, temporaryRoot).artifacts, true))) {
        throw new Error('The tracer staging deployment completed without all required startup files.')
      }
      try {
        await kudu.rename(temporaryRoot, root)
      } catch {
        // A concurrent run may have completed `root` first, so keep it. Otherwise move the invalid
        // `root` aside, which never deletes a tree another run just published, and retry.
        if (!(await kudu.hasArtifacts(spec.artifacts))) {
          await kudu.rename(root, temporaryPath(root))
          await kudu.rename(temporaryRoot, root)
        }
      }
      await removeLeftovers()

      return true
    },
  }
}

/**
 * Removes every staged tracer. Moving the staging root aside first is atomic, so a failed or
 * interrupted delete never leaves part of a tree under a root that `publish` reads as staged.
 */
export const removeStagedTracers = async (kudu: KuduClient, warn: (message: string) => void): Promise<void> => {
  await kudu.moveAside(AAS_SSI_STAGING_ROOT, temporaryPath(AAS_SSI_STAGING_ROOT))
  await removeTemporaryTrees(kudu, AAS_SSI_STAGING_ROOT, warn)
}

const temporaryPath = (path: string): string => `${path}.tmp-${randomBytes(4).toString('hex')}`

// Removes temporary trees left by earlier runs. Nothing runs from them, so a failure only warns.
const removeTemporaryTrees = async (
  kudu: KuduClient,
  path: string,
  warn: (message: string) => void,
  olderThanMinutes?: number
) => {
  try {
    await kudu.deleteTemporaryTrees(path, olderThanMinutes)
  } catch {
    warn(`Could not remove leftover tracer staging directories ${path}.tmp-*. The next run removes them.`)
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
