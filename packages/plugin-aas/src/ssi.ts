import {createHash} from 'node:crypto'
import path from 'node:path'

import type {Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import type {Readable} from 'node:stream'
import type {Headers} from 'tar-stream'

import {getLanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {LANGUAGE_METADATA} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {decompress} from 'fzstd'
import JSZip from 'jszip'
import {extract} from 'tar-stream'

export const OCI_INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json'
export const OCI_MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json'
export const FLEET_PACKAGE_MEDIA_TYPE = 'application/vnd.datadog.package.v1'
export const FLEET_PACKAGE_LAYER_MEDIA_TYPE = 'application/vnd.datadog.package.layer.v1.tar+zstd'
export const FLEET_PACKAGE_VERSION_ANNOTATION = 'com.datadoghq.package.version'

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/
const PACKAGE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/
const NON_X64_ARCHITECTURE = /(?:^|-)(?:arm|arm64|ia32|ppc64|s390x|wasm32)$/

export type AasSsiLanguage = Exclude<Language, 'ruby'>

export interface AasCodeRuntime {
  readonly language: AasSsiLanguage
  readonly runtimeVersion: string
  readonly libc: Libc
}

export interface OciDescriptor {
  readonly mediaType: string
  readonly size: number
  readonly digest: string
}

export interface FleetPackage {
  readonly packageVersion: string
  readonly manifestDigest: string
  readonly layer: OciDescriptor
}

interface ArchiveFile {
  readonly data: Buffer
  readonly mode: number
}

interface ArchiveLink {
  readonly linkname: string
  readonly type: 'link' | 'symlink'
}

interface Archive {
  readonly files: ReadonlyMap<string, ArchiveFile>
  readonly links: ReadonlyMap<string, ArchiveLink>
}

export const parseLinuxFxVersion = (linuxFxVersion: string | undefined): AasCodeRuntime => {
  const value = linuxFxVersion?.trim()
  if (!value) {
    throw new Error('The Linux Web App runtime is missing.')
  }

  const normalized = value.toUpperCase()
  if (normalized === 'SITECONTAINERS' || normalized.startsWith('DOCKER|') || normalized.startsWith('COMPOSE|')) {
    throw new Error(`Container runtime ${JSON.stringify(value)} is not supported for code-based APM injection.`)
  }

  const separator = value.indexOf('|')
  if (separator <= 0 || separator !== value.lastIndexOf('|') || separator === value.length - 1) {
    throw unsupportedRuntime(value)
  }

  const stack = value.slice(0, separator).toUpperCase()
  const version = value.slice(separator + 1)
  const runtime = parseRuntime(stack, version)
  if (!runtime) {
    throw unsupportedRuntime(value)
  }

  return runtime
}

export const getFleetRepository = (language: AasSsiLanguage): string =>
  `apm-library-${LANGUAGE_METADATA[language].tracerLanguage}-package`

export const selectFleetManifest = (index: unknown): OciDescriptor => {
  const indexRecord = asRecord(index, 'OCI index')
  if (indexRecord.schemaVersion !== 2 || indexRecord.mediaType !== OCI_INDEX_MEDIA_TYPE) {
    throw new Error('The Fleet package index is not a supported OCI index.')
  }

  if (!Array.isArray(indexRecord.manifests)) {
    throw new Error('The Fleet package index does not contain manifests.')
  }

  const linuxAmd64Manifests = indexRecord.manifests.filter(
    (value): value is Record<string, unknown> =>
      isRecord(value) &&
      isRecord(value.platform) &&
      value.platform.os === 'linux' &&
      value.platform.architecture === 'amd64'
  )
  if (linuxAmd64Manifests.length !== 1) {
    throw new Error('The Fleet package index must contain exactly one Linux amd64 manifest.')
  }
  if (linuxAmd64Manifests[0].artifactType !== FLEET_PACKAGE_MEDIA_TYPE) {
    throw new Error(
      `The Fleet package manifest has unsupported artifact type ${describe(linuxAmd64Manifests[0].artifactType)}.`
    )
  }

  return parseDescriptor(linuxAmd64Manifests[0], OCI_MANIFEST_MEDIA_TYPE, 'manifest')
}

export const resolveFleetPackage = (manifestDescriptor: OciDescriptor, manifest: unknown): FleetPackage => {
  const manifestRecord = asRecord(manifest, 'OCI manifest')
  if (manifestRecord.schemaVersion !== 2 || manifestRecord.mediaType !== OCI_MANIFEST_MEDIA_TYPE) {
    throw new Error('The Fleet package manifest is not a supported OCI manifest.')
  }

  parseDescriptor(manifestRecord.config, FLEET_PACKAGE_MEDIA_TYPE, 'config')

  if (!Array.isArray(manifestRecord.layers) || manifestRecord.layers.length !== 1) {
    throw new Error('The Fleet package manifest must contain exactly one package layer.')
  }
  const layer = parseDescriptor(manifestRecord.layers[0], FLEET_PACKAGE_LAYER_MEDIA_TYPE, 'layer')

  const annotations = asRecord(manifestRecord.annotations, 'OCI manifest annotations')
  const packageVersion = annotations[FLEET_PACKAGE_VERSION_ANNOTATION]
  if (typeof packageVersion !== 'string' || !PACKAGE_VERSION.test(packageVersion)) {
    throw new Error('The Fleet package manifest does not contain a valid package version annotation.')
  }

  return {packageVersion, manifestDigest: manifestDescriptor.digest, layer}
}

export const verifySha256 = (contents: Uint8Array, expectedDigest: string): void => {
  if (!SHA256_DIGEST.test(expectedDigest)) {
    throw new Error(`Invalid SHA-256 digest ${JSON.stringify(expectedDigest)}.`)
  }

  const actualDigest = `sha256:${createHash('sha256').update(contents).digest('hex')}`
  if (actualDigest !== expectedDigest) {
    throw new Error(`Fleet package layer digest mismatch: expected ${expectedDigest}, received ${actualDigest}.`)
  }
}

export const buildFleetPackageZip = async (
  compressedLayer: Uint8Array,
  expectedDigest: string,
  runtime: AasCodeRuntime
): Promise<Buffer> => {
  verifySha256(compressedLayer, expectedDigest)

  return buildFleetPackageZipFromTar(decompress(compressedLayer), runtime)
}

export const buildFleetPackageZipFromTar = async (tarArchive: Uint8Array, runtime: AasCodeRuntime): Promise<Buffer> => {
  const archive = await extractArchive(tarArchive)
  const selectedNames = [...archive.files.keys(), ...archive.links.keys()]
    .filter((name) => isSelectedRuntimeFile(name, runtime))
    .sort()

  assertRequiredArtifacts(selectedNames, runtime)

  const zip = new JSZip()
  for (const name of selectedNames) {
    const file = resolveArchiveFile(name, archive, new Set())
    zip.file(name, file.data, {unixPermissions: 0o100000 + (file.mode % 0o1000)})
  }

  return zip.generateAsync({type: 'nodebuffer', platform: 'UNIX'})
}

const parseRuntime = (
  stack: string,
  version: string
): Pick<AasCodeRuntime, 'language' | 'runtimeVersion' | 'libc'> | undefined => {
  if (stack === 'DOTNETCORE') {
    const match = version.match(/^(\d+)\.0$/)
    const major = match && Number(match[1])

    return major && major >= 8 && major <= 11
      ? {language: 'csharp', runtimeVersion: `${major}.0`, libc: 'glibc'}
      : undefined
  }

  if (stack === 'NODE') {
    const match = version.match(/^(\d+)(?:-lts)?$/i)
    const major = match && Number(match[1])

    return major && [22, 24, 26].includes(major)
      ? {language: 'nodejs', runtimeVersion: String(major), libc: 'glibc'}
      : undefined
  }

  if (stack === 'PYTHON') {
    const match = version.match(/^3\.(\d+)$/)
    const minor = match && Number(match[1])

    return minor && minor >= 10 && minor <= 14
      ? {language: 'python', runtimeVersion: `3.${minor}`, libc: 'glibc'}
      : undefined
  }

  if (stack === 'PHP') {
    const match = version.match(/^8\.(\d+)$/)
    const minor = match && Number(match[1])

    return minor && minor >= 2 && minor <= 5
      ? {language: 'php', runtimeVersion: `8.${minor}`, libc: 'glibc'}
      : undefined
  }

  if (stack === 'JAVA' || stack === 'TOMCAT' || stack === 'JBOSSEAP') {
    const match = version.match(stack === 'JAVA' ? /^(\d+)-(?:java|jre)(\d+)$/i : /^\d+(?:\.\d+)*-(?:java|jre)(\d+)$/i)
    if (!match) {
      return undefined
    }

    const jvmVersion = Number(match[stack === 'JAVA' ? 2 : 1])
    const javaStackVersion = stack === 'JAVA' ? Number(match[1]) : undefined
    if (jvmVersion < 8 || jvmVersion > 23 || (javaStackVersion !== undefined && javaStackVersion !== jvmVersion)) {
      return undefined
    }

    return {
      language: 'java',
      runtimeVersion: String(jvmVersion),
      libc: getJavaLibc(stack, version, jvmVersion),
    }
  }

  return undefined
}

const getJavaLibc = (stack: string, version: string, jvmVersion: number): Libc => {
  if (stack === 'JAVA' && jvmVersion <= 11) {
    return 'musl'
  }
  const serverMajor = Number(version.match(/^(\d+)/)?.[1])

  return stack === 'TOMCAT' && serverMajor < 10 && jvmVersion <= 11 ? 'musl' : 'glibc'
}

const unsupportedRuntime = (value: string): Error =>
  new Error(
    `Linux Web App runtime ${JSON.stringify(value)} is not supported. Supported runtimes are .NET 8-11, Node.js 22/24/26, Python 3.10-3.14, PHP 8.2-8.5, and Java 8-23.`
  )

const parseDescriptor = (value: unknown, expectedMediaType: string, name: string): OciDescriptor => {
  const descriptor = asRecord(value, `OCI ${name} descriptor`)
  if (descriptor.mediaType !== expectedMediaType) {
    throw new Error(`The Fleet package ${name} has unsupported media type ${describe(descriptor.mediaType)}.`)
  }
  if (typeof descriptor.digest !== 'string' || !SHA256_DIGEST.test(descriptor.digest)) {
    throw new Error(`The Fleet package ${name} has an invalid SHA-256 digest.`)
  }
  if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) <= 0) {
    throw new Error(`The Fleet package ${name} has an invalid size.`)
  }

  return {mediaType: descriptor.mediaType, digest: descriptor.digest, size: descriptor.size as number}
}

const extractArchive = (contents: Uint8Array): Promise<Archive> =>
  new Promise((resolve, reject) => {
    const files = new Map<string, ArchiveFile>()
    const links = new Map<string, ArchiveLink>()
    const tar = extract()

    tar.on('entry', (header, stream, next) => {
      collectEntry(header, stream, files, links, next, reject)
    })
    tar.on('error', reject)
    tar.on('finish', () => resolve({files, links}))
    tar.end(Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength))
  })

const collectEntry = (
  header: Headers,
  stream: Readable,
  files: Map<string, ArchiveFile>,
  links: Map<string, ArchiveLink>,
  next: () => void,
  reject: (error: Error) => void
): void => {
  let name: string
  try {
    name = normalizeArchivePath(header.name)
  } catch (error) {
    stream.resume()
    reject(error as Error)

    return
  }

  if (header.type === 'symlink' || header.type === 'link') {
    if (!header.linkname) {
      stream.resume()
      reject(new Error(`Archive link ${JSON.stringify(name)} has no target.`))

      return
    }
    links.set(name, {linkname: header.linkname, type: header.type})
    stream.resume()
    stream.on('end', next)

    return
  }

  if (header.type !== 'file') {
    stream.resume()
    stream.on('end', next)

    return
  }

  const chunks: Buffer[] = []
  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
  stream.on('error', reject)
  stream.on('end', () => {
    files.set(name, {data: Buffer.concat(chunks), mode: header.mode ?? 0o644})
    next()
  })
}

const assertRequiredArtifacts = (names: string[], runtime: AasCodeRuntime): void => {
  const selected = new Set(names)
  const spec = getLanguageInjectionSpec({
    language: runtime.language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc: runtime.libc,
    root: '/',
  })
  const missing = spec.artifacts.filter((alternatives) =>
    alternatives.every((artifact) => !selected.has(artifact.replace(/^\//, '')))
  )
  if (missing.length > 0) {
    throw new Error(
      `Fleet package is missing required startup artifacts: ${missing.map((paths) => paths.join(' or ')).join(', ')}.`
    )
  }
}

const isSelectedRuntimeFile = (name: string, runtime: AasCodeRuntime): boolean => {
  if (runtime.language === 'java') {
    return true
  }
  if (runtime.language === 'csharp') {
    return !name.split('/').some((part) => part.includes('musl'))
  }
  if (runtime.language === 'php') {
    return name.startsWith('linux-gnu/')
  }
  if (runtime.language === 'python') {
    const selectedPackage = `ddtrace_pkgs/site-packages-ddtrace-py${runtime.runtimeVersion}-manylinux2014-x86_64`

    return !name.includes('/') || name.startsWith(`${selectedPackage}/`)
  }

  const parts = name.split('/')
  const prebuilds = parts.lastIndexOf('prebuilds')
  const architecture = prebuilds >= 0 ? parts[prebuilds + 1] : undefined

  return !architecture || !NON_X64_ARCHITECTURE.test(architecture)
}

const resolveArchiveFile = (name: string, archive: Archive, seen: Set<string>): ArchiveFile => {
  const file = archive.files.get(name)
  if (file) {
    return file
  }
  if (seen.has(name)) {
    throw new Error(`Archive link cycle detected at ${JSON.stringify(name)}.`)
  }

  const link = archive.links.get(name)
  if (!link) {
    throw new Error(`Archive link target ${JSON.stringify(name)} does not exist.`)
  }

  const target = normalizeArchivePath(
    link.type === 'symlink' ? path.posix.join(path.posix.dirname(name), link.linkname) : link.linkname
  )

  return resolveArchiveFile(target, archive, new Set([...seen, name]))
}

const normalizeArchivePath = (value: string): string => {
  if (path.posix.isAbsolute(value)) {
    throw new Error(`Archive path ${JSON.stringify(value)} is outside the package root.`)
  }

  const normalized = path.posix.normalize(value.replace(/^\.\//, ''))
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Archive path ${JSON.stringify(value)} is outside the package root.`)
  }

  return normalized
}

const asRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`The ${name} is invalid.`)
  }

  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && !!value && !Array.isArray(value)

const describe = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : 'an invalid value')
