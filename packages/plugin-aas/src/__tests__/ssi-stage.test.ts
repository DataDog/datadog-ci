import type {KuduClient} from '../kudu'

import {removeStagedTracers, resolveAasTracerStaging} from '../ssi-stage'

jest.mock('@datadog/datadog-ci-base/helpers/request', () => ({
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

const ROOT = `/home/data/datadog-tracer/nodejs/1.2.3-${'a'.repeat(64)}`
const STARTUP_FILE = 'node_modules/dd-trace/init.js'

/** In-memory Web App filesystem: each directory is either a complete or a partial tracer tree. */
const createFakeKudu = (
  directories: Map<string, 'complete' | 'partial'>,
  {extracts = 'complete' as 'complete' | 'partial', onPublish = () => {}, failDelete = false} = {}
): KuduClient => ({
  publish: async (directory) => {
    directories.set(directory, extracts)
    onPublish()
  },
  hasArtifacts: async (artifacts) =>
    artifacts.every((alternatives) =>
      alternatives.some((artifact) => directories.get(artifact.replace(`/${STARTUP_FILE}`, '')) === 'complete')
    ),
  rename: async (source, target) => {
    const moved = [...directories].filter(([directory]) => directory === source || directory.startsWith(`${source}/`))
    if (moved.length === 0) {
      return
    }
    if (directories.has(target)) {
      throw new Error('rename failed')
    }
    moved.forEach(([directory, tree]) => {
      directories.delete(directory)
      directories.set(target + directory.slice(source.length), tree)
    })
  },
  deleteDirectory: async (pattern) => {
    if (failDelete) {
      throw new Error('delete failed')
    }
    const matches = pattern.endsWith('*')
      ? (directory: string) => directory.startsWith(pattern.slice(0, -1))
      : (directory: string) => directory === pattern
    ;[...directories.keys()].filter(matches).forEach((directory) => directories.delete(directory))
  },
})

const publish = async (kudu: KuduClient) => {
  const staging = await resolveAasTracerStaging({language: 'nodejs', runtimeVersion: '22', libc: 'glibc'})

  return staging.publish(kudu, jest.fn())
}

describe('resolveAasTracerStaging publish', () => {
  beforeEach(() => {
    // Skip the CIFS enumeration retry delays.
    jest.spyOn(global, 'setTimeout').mockImplementation((callback: () => void) => {
      callback()

      return 0 as unknown as NodeJS.Timeout
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('does not move a temporary tree without the startup files into the root', async () => {
    const directories = new Map<string, 'complete' | 'partial'>()

    await expect(publish(createFakeKudu(directories, {extracts: 'partial'}))).rejects.toThrow(
      'without all required startup files'
    )
    expect(directories.has(ROOT)).toBe(false)
  })

  test('replaces a partial root left by an earlier CLI version', async () => {
    const directories = new Map<string, 'complete' | 'partial'>([[ROOT, 'partial']])

    await expect(publish(createFakeKudu(directories))).resolves.toBe(true)
    expect(directories).toEqual(new Map([[ROOT, 'complete']]))
  })

  test('keeps a root that a concurrent run completed first', async () => {
    const directories = new Map<string, 'complete' | 'partial'>()
    const kudu = createFakeKudu(directories, {onPublish: () => directories.set(ROOT, 'complete')})

    await expect(publish(kudu)).resolves.toBe(true)
    expect(directories).toEqual(new Map([[ROOT, 'complete']]))
  })
})

describe('removeStagedTracers', () => {
  test('leaves no staged root when deleting the moved tree fails', async () => {
    const directories = new Map<string, 'complete' | 'partial'>([[ROOT, 'complete']])
    const warn = jest.fn()

    await removeStagedTracers(createFakeKudu(directories, {failDelete: true}), warn)

    expect(directories.has(ROOT)).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('The next run removes them.'))
  })
})
