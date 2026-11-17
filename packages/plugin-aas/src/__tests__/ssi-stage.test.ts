import type {KuduClient} from '../kudu'

import {getRequestError} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {removeStagedTracers, resolveAasTracerStaging} from '../ssi-stage'

jest.mock('@datadog/datadog-ci-base/helpers/request', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/request'),
  getProxyDispatcher: jest.fn(),
  httpRequest: jest.fn().mockResolvedValue({data: Buffer.from('{}')}),
}))

jest.mock('../ssi', () => ({
  ...jest.requireActual('../ssi'),
  selectFleetManifest: jest.fn().mockReturnValue({digest: 'sha256:manifest'}),
  verifySha256: jest.fn(),
  resolveFleetPackage: jest.fn().mockReturnValue({
    packageVersion: '1.2.3',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
    layer: {digest: 'sha256:layer', mediaType: 'application/octet-stream'},
  }),
  buildFleetPackageZip: jest.fn().mockResolvedValue(Buffer.from('zip')),
}))

const ROOT = `/home/data/datadog-tracer/published/nodejs/1.2.3-${'a'.repeat(64)}`
const STARTUP_FILE = 'node_modules/dd-trace/init.js'

type Tree = 'complete' | 'partial'

/** In-memory Web App filesystem: each directory is a complete or partial tracer tree. */
const createFakeKudu = (
  directories: Map<string, Tree>,
  {
    extracts = 'complete' as Tree,
    onPublish = () => {},
    onVerified = () => {},
    failDelete = false,
    stuck = false,
    stale = new Set<string>(),
    failedUploads = 0,
  } = {}
): KuduClient => {
  const move = (source: string, target: string) => {
    const moved = [...directories].filter(([directory]) => directory === source || directory.startsWith(`${source}/`))
    if (moved.length === 0) {
      return false
    }
    if (directories.has(target)) {
      throw new Error('rename failed')
    }
    moved.forEach(([directory, tree]) => {
      directories.delete(directory)
      directories.set(target + directory.slice(source.length), tree)
    })

    return true
  }

  let failuresLeft = failedUploads

  return {
    waitUntilReady: async () => {},
    publish: async (directory) => {
      if (failuresLeft-- > 0) {
        directories.set(directory, 'partial')
        throw getRequestError(502, {})
      }
      directories.set(directory, extracts)
      onPublish()
    },
    hasArtifacts: async (artifacts, waitUntilPresent) => {
      const present = artifacts.every((alternatives) =>
        alternatives.some((artifact) => directories.get(artifact.replace(`/${STARTUP_FILE}`, '')) === 'complete')
      )
      if (present && waitUntilPresent) {
        onVerified()
      }

      return present
    },
    rename: async (source, target) => {
      if (!move(source, target)) {
        throw new Error('missing source')
      }
    },
    moveAside: async (source, target) => {
      move(source, target)

      return !stuck
    },
    deleteTemporaryTrees: async (path, olderThanMinutes) => {
      if (failDelete) {
        throw new Error('delete failed')
      }
      ;[...directories.keys()]
        .filter((directory) => directory.startsWith(`${path}.tmp-`))
        .filter((directory) => olderThanMinutes === undefined || stale.has(directory))
        .forEach((directory) => directories.delete(directory))
    },
  }
}

const publish = async (kudu: KuduClient) => {
  const staging = await resolveAasTracerStaging({language: 'nodejs', runtimeVersion: '22', libc: 'glibc'})

  return staging.publish(kudu, jest.fn())
}

describe('resolveAasTracerStaging publish', () => {
  test('does not move a temporary tree without the startup files into the root', async () => {
    const directories = new Map<string, Tree>()

    await expect(publish(createFakeKudu(directories, {extracts: 'partial'}))).rejects.toThrow(
      'without all required startup files'
    )
    expect(directories.has(ROOT)).toBe(false)
  })

  test('fails when the verified temporary tree disappears before the rename', async () => {
    const directories = new Map<string, Tree>()
    const onVerified = () =>
      [...directories.keys()].filter((directory) => directory.includes('.tmp-')).forEach((d) => directories.delete(d))

    await expect(publish(createFakeKudu(directories, {onVerified}))).rejects.toThrow('missing source')
    expect(directories.has(ROOT)).toBe(false)
  })

  test('retries a gateway error into a new temporary tree and never renames the abandoned one', async () => {
    const directories = new Map<string, Tree>()

    await expect(publish(createFakeKudu(directories, {failedUploads: 1}))).resolves.toBe(true)
    expect(directories.get(ROOT)).toBe('complete')
    expect([...directories].filter(([directory]) => directory.startsWith(`${ROOT}.tmp-`))).toEqual([
      [expect.any(String), 'partial'],
    ])
  })

  test('fails after three gateway errors', async () => {
    const directories = new Map<string, Tree>()

    await expect(publish(createFakeKudu(directories, {failedUploads: 3}))).rejects.toThrow()
    expect(directories.has(ROOT)).toBe(false)
  })

  test('replaces a partial root', async () => {
    const directories = new Map<string, Tree>([[ROOT, 'partial']])

    await expect(publish(createFakeKudu(directories))).resolves.toBe(true)
    expect(directories.get(ROOT)).toBe('complete')
  })

  test('keeps a root that a concurrent run completed first', async () => {
    const directories = new Map<string, Tree>()
    const kudu = createFakeKudu(directories, {onPublish: () => directories.set(ROOT, 'complete')})

    await expect(publish(kudu)).resolves.toBe(true)
    expect(directories.get(ROOT)).toBe('complete')
  })

  test('removes only stale temporary trees, so an in-flight tree survives', async () => {
    const directories = new Map<string, Tree>([
      [`${ROOT}.tmp-inflight`, 'partial'],
      [`${ROOT}.tmp-stale`, 'partial'],
    ])

    await publish(createFakeKudu(directories, {stale: new Set([`${ROOT}.tmp-stale`])}))

    expect(directories.has(`${ROOT}.tmp-inflight`)).toBe(true)
    expect(directories.has(`${ROOT}.tmp-stale`)).toBe(false)
  })
})

describe('removeStagedTracers', () => {
  test('leaves no staged root when deleting the moved tree fails', async () => {
    const directories = new Map<string, Tree>([[ROOT, 'complete']])
    const warn = jest.fn()

    await removeStagedTracers(createFakeKudu(directories, {failDelete: true}), warn)

    expect(directories.has(ROOT)).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('The next run removes them.'))
  })

  test('warns when the staging root is still present after the move', async () => {
    const warn = jest.fn()

    await removeStagedTracers(createFakeKudu(new Map(), {stuck: true}), warn)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('still present'))
  })
})
