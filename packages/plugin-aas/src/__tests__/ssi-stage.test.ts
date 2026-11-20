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
  buildFleetPackageZips: jest
    .fn()
    .mockResolvedValue([Buffer.from('zip-1'), Buffer.from('zip-2'), Buffer.from('zip-3')]),
}))

const ROOT = `/home/data/datadog-tracer/nodejs/1.2.3-${'a'.repeat(64)}`
const STARTUP_FILE = 'node_modules/dd-trace/init.js'

type Tree = 'complete' | 'partial'

/** In-memory Web App filesystem: each directory is a complete or partial tracer tree. */
const createFakeKudu = (
  directories: Map<string, Tree>,
  {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- required by TypeScript 6
    extracts = 'complete' as Tree,
    onPublish = () => {},
    onVerified = () => {},
    failDelete = false,
    stuck = false,
    stale = new Set<string>(),
    failedUploads = 0,
    failingZip = '',
    retryAfter = '',
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
    publish: async (directory, zip) => {
      if (failuresLeft-- > 0) {
        directories.set(directory, 'partial')
        const error = getRequestError(502, {})
        error.response!.headers = {'retry-after': retryAfter}
        throw error
      }
      if (zip.toString() === failingZip) {
        directories.set(directory, 'partial')
        throw new Error('upload failed')
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
  afterEach(() => {
    jest.useRealTimers()
  })

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

  test.each([
    ['', 10_000],
    ['30', 30_000],
    ['Thu, 01 Jan 2026 00:00:30 GMT', 30_000],
    ['invalid', 10_000],
    ['999999', 60_000],
  ])('retries into a fresh tree after backoff with Retry-After=%s', async (retryAfter, delay) => {
    jest.useFakeTimers({now: new Date('2026-01-01T00:00:00Z')})
    const started = Date.now()
    const directories = new Map<string, Tree>()
    const result = publish(createFakeKudu(directories, {failedUploads: 1, retryAfter}))

    await jest.runAllTimersAsync()
    await expect(result).resolves.toBe(true)

    expect(Date.now() - started).toBe(delay)
    expect(directories.get(ROOT)).toBe('complete')
    expect([...directories.keys()].filter((directory) => directory.startsWith(`${ROOT}.tmp-`))).toHaveLength(1)
  })

  test('waits for in-flight uploads before retrying after a gateway error', async () => {
    jest.useFakeTimers()
    const directories = new Map<string, Tree>()
    const kudu = createFakeKudu(directories)
    const fakePublish = kudu.publish
    let active = 0
    let activeAtRetry: number | undefined
    let firstDirectory: string | undefined
    kudu.publish = async (directory, zip) => {
      firstDirectory ??= directory
      if (directory !== firstDirectory) {
        activeAtRetry ??= active

        return fakePublish(directory, zip)
      }
      active++
      try {
        if (zip.toString() === 'zip-1') {
          throw getRequestError(502, {})
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      } finally {
        active--
      }
    }

    const result = publish(kudu)
    await jest.runAllTimersAsync()
    await expect(result).resolves.toBe(true)
    expect(activeAtRetry).toBe(0)
  })

  test('does not retry when a concurrent upload fails with a nonretryable error', async () => {
    jest.useFakeTimers()
    const directories = new Map<string, Tree>()
    const kudu = createFakeKudu(directories)
    const denied = getRequestError(403, {})
    jest
      .spyOn(kudu, 'publish')
      .mockRejectedValueOnce(getRequestError(502, {}))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        throw denied
      })
    const result = publish(kudu).catch((error: unknown) => error)

    await jest.runAllTimersAsync()

    expect(await result).toBe(denied)
    expect(directories.has(ROOT)).toBe(false)
  })

  test('fails after backing off between three failed upload attempts', async () => {
    jest.useFakeTimers()
    const started = Date.now()
    const directories = new Map<string, Tree>()
    const result = publish(createFakeKudu(directories, {failedUploads: Infinity})).catch((error: unknown) => error)

    await jest.runAllTimersAsync()
    expect(await result).toBeInstanceOf(Error)

    expect(Date.now() - started).toBe(30_000)
    expect(directories.has(ROOT)).toBe(false)
  })

  test('does not move a temporary tree into the root when one zip fails to upload', async () => {
    const directories = new Map<string, Tree>()

    await expect(publish(createFakeKudu(directories, {failingZip: 'zip-2'}))).rejects.toThrow('upload failed')
    expect(directories.has(ROOT)).toBe(false)
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
