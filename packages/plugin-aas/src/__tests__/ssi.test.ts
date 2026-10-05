import {createHash} from 'node:crypto'

import JSZip from 'jszip'

import {
  FLEET_PACKAGE_LAYER_MEDIA_TYPE,
  FLEET_PACKAGE_MEDIA_TYPE,
  FLEET_PACKAGE_VERSION_ANNOTATION,
  OCI_INDEX_MEDIA_TYPE,
  OCI_MANIFEST_MEDIA_TYPE,
  buildFleetPackageZip,
  buildFleetPackageZipFromTar,
  getFleetRepository,
  parseLinuxFxVersion,
  resolveFleetPackage,
  selectFleetManifest,
  verifySha256,
  type AasCodeRuntime,
} from '../ssi'
import {mergeAasSsiEnv} from '../ssi-env'

const DIGEST = `sha256:${'a'.repeat(64)}`
const LAYER_DIGEST = `sha256:${'b'.repeat(64)}`
const COMPRESSED_JAVA_PACKAGE = Buffer.from(
  'KLUv/WQADx0FACKHFheANW5I4ktEI23iPxqR6ahiJHHBUyYeNmYpZFjzPmNZfRWDbqVdsYJldhjL+J8g1PW+AOuiT3/C6vogR/KF0hyROZn5PGkQpXOlFqak/hPWVlyxABX0aROGIRkA/UEF8qBAdcGXDKgDuguYQfKLSesDdYwBdTBAniD40mlPQYWpXxMschRgagltAphmABDqBateAJAGYAtmgBsrlvEoCAPaY1wm',
  'base64'
)
const COMPRESSED_JAVA_PACKAGE_DIGEST = 'sha256:f8ca9ebea82ff9821ed897389aa71368d29880a7f9a96df477599285cea40163'

const INDEX = {
  schemaVersion: 2,
  mediaType: OCI_INDEX_MEDIA_TYPE,
  manifests: [
    {
      mediaType: OCI_MANIFEST_MEDIA_TYPE,
      size: 500,
      digest: DIGEST,
      platform: {architecture: 'arm64', os: 'linux'},
      artifactType: FLEET_PACKAGE_MEDIA_TYPE,
    },
    {
      mediaType: OCI_MANIFEST_MEDIA_TYPE,
      size: 500,
      digest: DIGEST,
      platform: {architecture: 'amd64', os: 'linux'},
      artifactType: FLEET_PACKAGE_MEDIA_TYPE,
    },
    {
      mediaType: OCI_MANIFEST_MEDIA_TYPE,
      size: 500,
      digest: DIGEST,
      platform: {architecture: 'amd64', os: 'windows'},
      artifactType: FLEET_PACKAGE_MEDIA_TYPE,
    },
  ],
}

type TarEntry = {
  name: string
  type: 'file' | 'symlink'
  contents?: string
  linkname?: string
  mode: number
}

const file = (name: string, contents = name, mode = 0o644): TarEntry => ({name, type: 'file', contents, mode})
const symlink = (name: string, linkname: string): TarEntry => ({name, type: 'symlink', linkname, mode: 0o777})

const MANIFEST = {
  schemaVersion: 2,
  mediaType: OCI_MANIFEST_MEDIA_TYPE,
  config: {mediaType: FLEET_PACKAGE_MEDIA_TYPE, size: 100, digest: DIGEST},
  layers: [{mediaType: FLEET_PACKAGE_LAYER_MEDIA_TYPE, size: 200, digest: LAYER_DIGEST}],
  annotations: {[FLEET_PACKAGE_VERSION_ANNOTATION]: '1.2.3'},
}

describe('AAS SSI runtime', () => {
  test.each([
    ['DOTNETCORE|8.0', 'csharp', '8.0', 'glibc'],
    ['dotnetcore|11.0', 'csharp', '11.0', 'glibc'],
    ['NODE|22-lts', 'nodejs', '22', 'glibc'],
    ['node|26-LTS', 'nodejs', '26', 'glibc'],
    ['PYTHON|3.10', 'python', '3.10', 'glibc'],
    ['python|3.14', 'python', '3.14', 'glibc'],
    ['PHP|8.2', 'php', '8.2', 'glibc'],
    ['php|8.5', 'php', '8.5', 'glibc'],
    ['JAVA|8-jre8', 'java', '8', 'musl'],
    ['java|23-JAVA23', 'java', '23', 'glibc'],
    ['TOMCAT|9.0-java11', 'java', '11', 'musl'],
    ['tomcat|10.1-java17', 'java', '17', 'glibc'],
    ['JBOSSEAP|8-java17', 'java', '17', 'glibc'],
  ])('parses %s', (value, language, runtimeVersion, libc) => {
    expect(parseLinuxFxVersion(value)).toEqual({language, runtimeVersion, libc})
  })

  test.each([
    undefined,
    '',
    'NODE',
    'NODE|20-lts',
    'PYTHON|3.15',
    'PHP|8.1',
    'DOTNETCORE|12.0',
    'JAVA|24-java24',
    'JAVA|17-java21',
    'TOMCAT|10.1',
    'RUBY|3.3',
    'DOCKER|example/image:latest',
    'SITECONTAINERS',
  ])('rejects unsupported or malformed runtime %p', (value) => {
    expect(() => parseLinuxFxVersion(value)).toThrow()
  })

  test('replaces legacy AAS .NET paths with the staged tracer paths', () => {
    const root = '/home/data/datadog-tracer/csharp/1.2.3-sha256'
    const env = mergeAasSsiEnv(
      {
        CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
        DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
        CUSTOMER_SETTING: 'preserved',
      },
      parseLinuxFxVersion('DOTNETCORE|8.0'),
      root
    )

    expect(env).toMatchObject({
      CORECLR_PROFILER_PATH: `${root}/Datadog.Trace.ClrProfiler.Native.so`,
      DD_DOTNET_TRACER_HOME: root,
      CUSTOMER_SETTING: 'preserved',
    })
  })

  test.each([
    ['csharp', 'apm-library-dotnet-package'],
    ['java', 'apm-library-java-package'],
    ['nodejs', 'apm-library-js-package'],
    ['php', 'apm-library-php-package'],
    ['python', 'apm-library-python-package'],
  ] as const)('derives the %s Fleet repository from shared language metadata', (language, repository) => {
    expect(getFleetRepository(language)).toBe(repository)
  })
})

describe('Fleet OCI package', () => {
  test('selects and validates the Linux amd64 package', () => {
    expect(resolveFleetPackage(selectFleetManifest(INDEX), MANIFEST)).toEqual({
      packageVersion: '1.2.3',
      manifestDigest: DIGEST,
      layer: MANIFEST.layers[0],
    })
  })

  test.each([
    ['index media type', {...INDEX, mediaType: OCI_MANIFEST_MEDIA_TYPE}, MANIFEST, 'supported OCI index'],
    [
      'Linux amd64 descriptor',
      {...INDEX, manifests: INDEX.manifests.filter(({platform}) => platform.architecture !== 'amd64')},
      MANIFEST,
      'exactly one Linux amd64 manifest',
    ],
    [
      'package artifact type',
      {
        ...INDEX,
        manifests: INDEX.manifests.map((descriptor) =>
          descriptor.platform.os === 'linux' && descriptor.platform.architecture === 'amd64'
            ? {...descriptor, artifactType: 'application/octet-stream'}
            : descriptor
        ),
      },
      MANIFEST,
      'unsupported artifact type',
    ],
    [
      'single layer',
      INDEX,
      {...MANIFEST, layers: [...MANIFEST.layers, ...MANIFEST.layers]},
      'exactly one package layer',
    ],
    [
      'zstd layer media type',
      INDEX,
      {...MANIFEST, layers: [{...MANIFEST.layers[0], mediaType: 'application/octet-stream'}]},
      'unsupported media type',
    ],
    ['package version annotation', INDEX, {...MANIFEST, annotations: {}}, 'valid package version annotation'],
  ])('rejects an invalid %s', (_name, index, manifest, error) => {
    expect(() => resolveFleetPackage(selectFleetManifest(index), manifest)).toThrow(error)
  })

  test('accepts content matching its SHA-256 digest', () => {
    const contents = Buffer.from('verified layer')
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`

    expect(() => verifySha256(contents, digest)).not.toThrow()
  })

  test('rejects a digest mismatch', () => {
    expect(() => verifySha256(Buffer.from('corrupt layer'), LAYER_DIGEST)).toThrow('digest mismatch')
  })
})

describe('Fleet package ZIP', () => {
  test('verifies and decompresses a zstd Fleet layer', async () => {
    const contents = await buildFleetPackageZip(
      COMPRESSED_JAVA_PACKAGE,
      COMPRESSED_JAVA_PACKAGE_DIGEST,
      parseLinuxFxVersion('JAVA|17-java17')
    )
    const zip = await JSZip.loadAsync(contents)

    expect(await zip.file('dd-java-agent.jar')!.async('string')).toBe('jar')
  })

  test.each([
    {
      runtime: 'JAVA|17-java17',
      entries: [file('dd-java-agent.jar'), file('requirements.json')],
      included: ['dd-java-agent.jar', 'requirements.json'],
      excluded: [],
    },
    {
      runtime: 'DOTNETCORE|8.0',
      entries: [
        file('Datadog.Trace.ClrProfiler.Native.so'),
        file('continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'),
        file('linux-x64/native.so'),
        file('linux-musl-x64/native.so'),
      ],
      included: [
        'Datadog.Trace.ClrProfiler.Native.so',
        'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so',
        'linux-x64/native.so',
      ],
      excluded: ['linux-musl-x64/native.so'],
    },
    {
      runtime: 'PHP|8.3',
      entries: [
        file('linux-gnu/loader/dd_library_loader.ini'),
        file('linux-gnu/loader/dd_library_loader.so'),
        file('linux-gnu/tracer.so'),
        file('linux-musl/tracer.so'),
        file('appsec/recommended.json'),
      ],
      included: [
        'linux-gnu/loader/dd_library_loader.ini',
        'linux-gnu/loader/dd_library_loader.so',
        'linux-gnu/tracer.so',
      ],
      excluded: ['linux-musl/tracer.so', 'appsec/recommended.json'],
    },
    {
      runtime: 'PYTHON|3.12',
      entries: [
        file('sitecustomize.py'),
        file('version'),
        file('ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-x86_64/native.so'),
        symlink(
          'ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-x86_64/shared.py',
          '../site-packages-ddtrace-py3.12-manylinux2014-aarch64/shared.py'
        ),
        file('ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-aarch64/shared.py', 'shared'),
        file('ddtrace_pkgs/site-packages-ddtrace-py3.13-manylinux2014-x86_64/native.so'),
      ],
      included: [
        'sitecustomize.py',
        'version',
        'ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-x86_64/native.so',
        'ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-x86_64/shared.py',
      ],
      excluded: [
        'ddtrace_pkgs/site-packages-ddtrace-py3.12-manylinux2014-aarch64/shared.py',
        'ddtrace_pkgs/site-packages-ddtrace-py3.13-manylinux2014-x86_64/native.so',
      ],
    },
    {
      runtime: 'NODE|24-lts',
      entries: [
        file('node_modules/dd-trace/init.js'),
        file('node_modules/tool/bin.js', 'tool'),
        symlink('node_modules/.bin/tool', '../tool/bin.js'),
        file('node_modules/native/prebuilds/linux-x64/native.node'),
        file('node_modules/native/prebuilds/linux-arm64/native.node'),
        file('node_modules/native/prebuilds/library_config/config.js'),
      ],
      included: [
        'node_modules/dd-trace/init.js',
        'node_modules/tool/bin.js',
        'node_modules/.bin/tool',
        'node_modules/native/prebuilds/linux-x64/native.node',
        'node_modules/native/prebuilds/library_config/config.js',
      ],
      excluded: ['node_modules/native/prebuilds/linux-arm64/native.node'],
    },
  ])('prunes $runtime to its usable slice', async ({runtime, entries, included, excluded}) => {
    const zip = await loadZip(entries, parseLinuxFxVersion(runtime))

    expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir)).toEqual(expect.arrayContaining(included))
    for (const name of excluded) {
      expect(zip.file(name)).toBeNull()
    }
  })

  test('materializes a symlink as a regular executable ZIP entry', async () => {
    const zip = await loadZip(
      [
        file('node_modules/dd-trace/init.js'),
        file('node_modules/tool/bin.js', 'echo tool', 0o755),
        symlink('bin/tool', '../node_modules/tool/bin.js'),
      ],
      parseLinuxFxVersion('NODE|22-lts')
    )
    const entry = zip.file('bin/tool')!

    expect(await entry.async('string')).toBe('echo tool')
    const permissions = entry.unixPermissions as number
    expect(Math.floor(permissions / 0o100000)).toBe(1)
    expect(permissions % 0o1000).toBe(0o755)
  })

  test('rejects a selected slice without every required startup artifact', async () => {
    await expect(
      buildFleetPackageZipFromTar(
        createTar([file('continuousprofiler/Datadog.Linux.ApiWrapper.x64.so')]),
        parseLinuxFxVersion('DOTNETCORE|8.0')
      )
    ).rejects.toThrow('Datadog.Trace.ClrProfiler.Native.so')
  })
})

const loadZip = async (entries: TarEntry[], runtime: AasCodeRuntime): Promise<JSZip> =>
  JSZip.loadAsync(await buildFleetPackageZipFromTar(createTar(entries), runtime))

const createTar = (entries: TarEntry[]): Buffer =>
  Buffer.concat([...entries.flatMap((entry) => tarEntry(entry)), Buffer.alloc(1024)])

const tarEntry = (entry: TarEntry): Buffer[] => {
  const contents = Buffer.from(entry.contents ?? '')
  const header = Buffer.alloc(512)
  writeString(header, entry.name, 0, 100)
  writeOctal(header, entry.mode, 100, 8)
  writeOctal(header, 0, 108, 8)
  writeOctal(header, 0, 116, 8)
  writeOctal(header, entry.type === 'file' ? contents.length : 0, 124, 12)
  writeOctal(header, 0, 136, 12)
  header.fill(0x20, 148, 156)
  header[156] = entry.type === 'file' ? 0x30 : 0x32
  writeString(header, entry.linkname ?? '', 157, 100)
  writeString(header, 'ustar\0', 257, 6)
  writeString(header, '00', 263, 2)
  writeOctal(
    header,
    [...header].reduce((sum, value) => sum + value, 0),
    148,
    8
  )

  return [header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]
}

const writeString = (buffer: Buffer, value: string, offset: number, length: number): void => {
  buffer.write(value, offset, length, 'utf8')
}

const writeOctal = (buffer: Buffer, value: number, offset: number, length: number): void => {
  buffer.write(`${value.toString(8).padStart(length - 2, '0')}\0 `, offset, length, 'ascii')
}
