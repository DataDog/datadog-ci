import {existsSync, promises} from 'fs'
import {platform} from 'os'

import {createMockContext, getEnvVarPlaceholders} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as APIKeyHelpers from '@datadog/datadog-ci-base/helpers/apikey'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {buildPath} from '@datadog/datadog-ci-base/helpers/utils'
import {Cli} from 'clipanion'
import upath from 'upath'

import {CompressedDsym, Dsym, GitData} from '../interfaces'
import {DsymsUploadCommand} from '../upload'
import {createUniqueTmpDirectory, deleteDirectory} from '../utils'

/**
 * `dwarfdump` and `lipo` are only available in macOS, so we mock their behaviour when running tests on other platforms.
 */
const mockDwarfdumpAndLipoIfNotMacOS = () => {
  if (platform() !== 'darwin') {
    // For `dwarfdump --uuid` mock, return the same output as the command would give on macOS:
    require('../utils').executeDwarfdump = jest.fn().mockImplementation((dsymPath: string) => {
      let fixture = dsymPath.includes('multiple-archs') ? fatDSYMFixture : undefined
      fixture = fixture || (dsymPath.includes('single-arch') ? slimDSYMFixture : undefined)

      if (fixture !== undefined) {
        const outputLines = fixture.dwarf.map((dwarf) => {
          const objectPathInDsym = upath.relative(fixture!.bundle, dwarf.object)
          const objectPathInMockedDSYM = buildPath(dsymPath, objectPathInDsym)

          return `UUID: ${dwarf.uuid} (${dwarf.arch}) ${objectPathInMockedDSYM}`
        })

        return {stderr: '', stdout: outputLines.join('\n')}
      } else {
        throw new Error(`Cannot find mock dSYM fixture for dsymPath: ${dsymPath}`)
      }
    })

    // For `lipo -thin` mock, just copy the object to new location (without extracting the slice as macOS would do):
    require('../utils').executeLipo = jest
      .fn()
      .mockImplementation(async (objectPath: string, arch: string, newObjectPath: string) => {
        await promises.copyFile(objectPath, newObjectPath)

        return {stderr: '', stdout: ''}
      })
  }
}

/**
 * Fixture for dSYM containing two arch slices. This is the same dSYM information as can be
 * read with `dwarfdump --uuid ./src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM` on macOS.
 */
const fatDSYMFixture: Dsym = {
  bundle: 'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM',
  dwarf: [
    {
      arch: 'arm64',
      object:
        'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest.debug.dylib',
      uuid: '736806EB-DDE8-3B08-BCBC-7C2BA338CCF2',
    },
    {
      arch: 'armv7',
      object:
        'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest',
      uuid: 'C8469F85-B060-3085-B69D-E46C645560EA',
    },
    {
      arch: 'arm64',
      object:
        'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest',
      uuid: '06EE3D68-D605-3E92-B92D-2F48C02A505E',
    },
  ],
}

/**
 * Fixture for dSYM containing single arch slice. This is the same dSYM information as can be
 * read with `dwarfdump --uuid ./src/commands/dsyms/__tests__/fixtures/single-archs/DDTest.framework.dSYM` on macOS.
 */
const slimDSYMFixture: Dsym = {
  bundle: 'src/commands/dsyms/__tests__/fixtures/single-arch/DDTest.framework.dSYM',
  dwarf: [
    {
      arch: 'arm64',
      object: 'src/commands/dsyms/__tests__/fixtures/single-arch/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest',
      uuid: '3BC12422-63CC-30E8-B916-E5006CE3286C',
    },
  ],
}

describe('upload', () => {
  beforeAll(() => {
    mockDwarfdumpAndLipoIfNotMacOS()
  })

  describe('findDsyms', () => {
    const command = new DsymsUploadCommand()

    test('Should find dSYMs recursively', async () => {
      const actualDSYMs = await command['findDsyms']('src/commands/dsyms/__tests__/fixtures')

      expect(actualDSYMs.length).toEqual(2)
      expect(actualDSYMs).toContainEqual(fatDSYMFixture)
      expect(actualDSYMs).toContainEqual(slimDSYMFixture)
    })
  })

  describe('parseDwarfdumpOutput', () => {
    const command = new DsymsUploadCommand()

    test('Should read arch slice from single-line output', () => {
      const output = 'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo'

      const dwarf = command['parseDwarfdumpOutput'](output)
      expect(dwarf).toEqual([
        {
          arch: 'arm64',
          object: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
      ])
    })

    test('Should read arch slices from multi-line output', () => {
      const output =
        'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n' +
        'UUID: AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE (x86_64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n' +
        'UUID: FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF (armv7) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n'

      const dwarf = command['parseDwarfdumpOutput'](output)
      expect(dwarf).toEqual([
        {
          arch: 'arm64',
          object: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
        {
          arch: 'x86_64',
          object: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        },
        {
          arch: 'armv7',
          object: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
        },
      ])
    })

    test('Should read arch slice if object path contains whitespaces', () => {
      const output =
        'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder with whitespaces/Foo Bar.dSYM/Contents/Resources/DWARF/Foo Bar'

      const dwarf = command['parseDwarfdumpOutput'](output)
      expect(dwarf).toEqual([
        {
          arch: 'arm64',
          object: '/folder with whitespaces/Foo Bar.dSYM/Contents/Resources/DWARF/Foo Bar',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
      ])
    })

    test('Should read no arch slices from invalid output', () => {
      const dwarf = command['parseDwarfdumpOutput']('')
      expect(dwarf).toEqual([])
    })
  })

  describe('processDsyms', () => {
    const command = new DsymsUploadCommand()

    test('Given fat dSYM, it should extract each arch slice to separate dSYM in target folder', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()

      // Given
      const inputDSYM = fatDSYMFixture
      expect(inputDSYM.dwarf.length).toBeGreaterThan(1)

      // When
      const extractedDSYMs = await command['processDsyms']([inputDSYM], tmpDirectory)

      // Then
      expect(extractedDSYMs.length).toEqual(inputDSYM.dwarf.length)
      expect(extractedDSYMs).toContainEqual({
        bundle: `${tmpDirectory}/736806EB-DDE8-3B08-BCBC-7C2BA338CCF2.dSYM`,
        dwarf: [
          {
            arch: 'arm64',
            object: `${tmpDirectory}/736806EB-DDE8-3B08-BCBC-7C2BA338CCF2.dSYM/Contents/Resources/DWARF/DDTest.debug.dylib`,
            uuid: '736806EB-DDE8-3B08-BCBC-7C2BA338CCF2',
          },
        ],
      })

      expect(extractedDSYMs).toContainEqual({
        bundle: `${tmpDirectory}/C8469F85-B060-3085-B69D-E46C645560EA.dSYM`,
        dwarf: [
          {
            arch: 'armv7',
            object: `${tmpDirectory}/C8469F85-B060-3085-B69D-E46C645560EA.dSYM/Contents/Resources/DWARF/DDTest`,
            uuid: 'C8469F85-B060-3085-B69D-E46C645560EA',
          },
        ],
      })

      expect(extractedDSYMs).toContainEqual({
        bundle: `${tmpDirectory}/06EE3D68-D605-3E92-B92D-2F48C02A505E.dSYM`,
        dwarf: [
          {
            arch: 'arm64',
            object: `${tmpDirectory}/06EE3D68-D605-3E92-B92D-2F48C02A505E.dSYM/Contents/Resources/DWARF/DDTest`,
            uuid: '06EE3D68-D605-3E92-B92D-2F48C02A505E',
          },
        ],
      })

      const objectFilesInTargetFolder = globSync(buildPath(tmpDirectory, '**/Contents/Resources/DWARF/DDTest*'))
      expect(objectFilesInTargetFolder.length).toEqual(inputDSYM.dwarf.length)

      await deleteDirectory(tmpDirectory)
    })

    test('Given slim dSYM, it should leave it untouched and not extract anything into target folder', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()

      // Given
      const inputDSYM = slimDSYMFixture
      expect(inputDSYM.dwarf.length).toEqual(1)

      // When
      const extractedDSYMs = await command['processDsyms']([inputDSYM], tmpDirectory)

      // Then
      expect(extractedDSYMs).toEqual([inputDSYM])
      const filesInTargetFolder = globSync(buildPath(tmpDirectory, '*'))
      expect(filesInTargetFolder.length).toEqual(0)

      await deleteDirectory(tmpDirectory)
    })
  })

  describe('compressDsyms', () => {
    const command = new DsymsUploadCommand()

    test('Should archive dSYMs to target directory and name archives by their UUIDs', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()
      const dsymFixtures = [fatDSYMFixture, slimDSYMFixture]

      // When
      const compressedDSYMs = await command['compressDsyms'](dsymFixtures, tmpDirectory)

      // Then
      expect(compressedDSYMs[0].dsym).toEqual(dsymFixtures[0])
      expect(compressedDSYMs[0].archivePath).toEqual(buildPath(tmpDirectory, `${dsymFixtures[0].dwarf[0].uuid}.zip`))
      expect(existsSync(compressedDSYMs[0].archivePath)).toBeTruthy()

      expect(compressedDSYMs[1].dsym).toEqual(dsymFixtures[1])
      expect(compressedDSYMs[1].archivePath).toEqual(buildPath(tmpDirectory, `${dsymFixtures[1].dwarf[0].uuid}.zip`))
      expect(existsSync(compressedDSYMs[1].archivePath)).toBeTruthy()

      await deleteDirectory(tmpDirectory)
    })
  })
})

describe('execute', () => {
  const runCLI = async (dsymPath: string, options?: {configPath?: string; env?: Record<string, string>}) => {
    const cli = new Cli()
    cli.register(DsymsUploadCommand)

    const context = createMockContext()
    const command = ['dsyms', 'upload', dsymPath, '--dry-run']
    if (options?.configPath) {
      command.push('--config')
      command.push(options.configPath)
    } else {
      process.env = getEnvVarPlaceholders()
    }
    if (options?.env) {
      process.env = {
        ...process.env,
        ...options.env,
      }
    }
    const code = await cli.run(command, context)

    return {context, code}
  }

  beforeAll(() => {
    mockDwarfdumpAndLipoIfNotMacOS()
  })

  test('Should succeed with folder input', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/')
    const outputString = context.stdout.toString()
    const output = outputString.split('\n')

    expect(outputString).not.toContain('Error')
    expect(code).toBe(0)
    expect(output[1]).toContain('Starting upload with concurrency 20. ')
    expect(output[2]).toContain('Will look for dSYMs in src/commands/dsyms/__tests__/fixtures/')
    expect(output[3]).toContain(
      'Once dSYMs upload is successful files will be processed and ready to use within the next 5 minutes.'
    )
    expect(output[4]).toContain('Will use temporary intermediate directory: ')
    expect(output[5]).toContain('Will use temporary upload directory: ')
    expect(output[6]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[7]).toContain(
      'Uploading 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2.zip (DDTest.debug.dylib, arch: arm64, UUID: 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2)'
    )
    expect(output[8]).toContain(
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[9]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )
    expect(output[12]).toContain('Handled 4 dSYMs with success')
  })

  test('Should succeed with zip file input', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/all.zip')
    const outputString = context.stdout.toString()
    const output = outputString.split('\n')

    expect(outputString).not.toContain('Error')
    expect(code).toBe(0)
    expect(output[1]).toContain('Starting upload with concurrency 20. ')
    expect(output[2]).toContain('Will look for dSYMs in src/commands/dsyms/__tests__/fixtures/all.zip')
    expect(output[3]).toContain(
      'Once dSYMs upload is successful files will be processed and ready to use within the next 5 minutes.'
    )
    expect(output[4]).toContain('Will use temporary intermediate directory: ')
    expect(output[5]).toContain('Will use temporary upload directory: ')
    expect(output[6]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[7]).toContain(
      'Uploading 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2.zip (DDTest.debug.dylib, arch: arm64, UUID: 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2)'
    )
    expect(output[8]).toContain(
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[9]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )

    expect(output[12]).toContain('Handled 4 dSYMs with success')
  })

  test('Should succeed with API key and site from datadog.json file', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/', {
      configPath: 'src/commands/dsyms/__tests__/fixtures/datadog-ci.json',
    })
    const outputString = context.stdout.toString()
    const output = outputString.split('\n')

    expect(outputString).not.toContain('Error')
    expect(code).toBe(0)
    expect(output[1]).toContain('Starting upload with concurrency 20. ')
    expect(output[2]).toContain('Will look for dSYMs in src/commands/dsyms/__tests__/fixtures/')
    expect(output[3]).toContain(
      'Once dSYMs upload is successful files will be processed and ready to use within the next 5 minutes.'
    )
    expect(output[4]).toContain('Will use temporary intermediate directory: ')
    expect(output[5]).toContain('Will use temporary upload directory: ')
    expect(output[6]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[7]).toContain(
      'Uploading 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2.zip (DDTest.debug.dylib, arch: arm64, UUID: 736806EB-DDE8-3B08-BCBC-7C2BA338CCF2)'
    )
    expect(output[8]).toContain(
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[9]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )
    expect(output[12]).toContain('Handled 4 dSYMs with success')
  })

  test('Should use API Key from env over config from JSON file', async () => {
    const apiKeyValidatorSpy = jest.spyOn(APIKeyHelpers, 'newApiKeyValidator')

    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/', {
      configPath: 'src/commands/dsyms/__tests__/fixtures/datadog-ci.json',
      env: {
        DATADOG_API_KEY: 'env_API_key',
      },
    })

    const outputString = context.stdout.toString()
    const output = outputString.split('\n')
    expect(code).toBe(0)

    expect(apiKeyValidatorSpy).toHaveBeenCalledWith({
      apiKey: 'env_API_key',
      datadogSite: expect.anything(),
      metricsLogger: expect.anything(),
    })
    expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
    expect(output).toContain('The environment API key ending in _key will be used.')
  })
})

describe('git data', () => {
  describe('CompressedDsym with git data', () => {
    test('Should include git information in metadata payload when gitData is provided', () => {
      const dsym: Dsym = {
        bundle: '/path/to/test.dSYM',
        dwarf: [
          {
            object: '/path/to/test.dSYM/Contents/Resources/DWARF/test',
            uuid: 'ABC123-DEF456-789012',
            arch: 'arm64',
          },
        ],
      }

      const gitData: GitData = {
        gitRepositoryURL: 'https://github.com/DataDog/dd-sdk-ios',
        gitCommitSha: 'abc123def456789',
      }

      const compressed = new CompressedDsym('/tmp/test.zip', dsym)
      compressed.gitData = gitData

      const payload = compressed.asMultipartPayload()

      const eventContent = payload.content.get('event')
      expect(eventContent).toBeDefined()
      expect(eventContent?.type).toBe('string')

      const metadata = JSON.parse((eventContent as any).value)
      expect(metadata.type).toBe('ios_symbols')
      expect(metadata.uuids).toBe('ABC123-DEF456-789012')
      expect(metadata.git_repository_url).toBe('https://github.com/DataDog/dd-sdk-ios')
      expect(metadata.git_commit_sha).toBe('abc123def456789')
    })

    test('Should not include git information in metadata payload when gitData is not provided', () => {
      const dsym: Dsym = {
        bundle: '/path/to/test.dSYM',
        dwarf: [
          {
            object: '/path/to/test.dSYM/Contents/Resources/DWARF/test',
            uuid: 'ABC123-DEF456-789012',
            arch: 'arm64',
          },
        ],
      }

      const compressed = new CompressedDsym('/tmp/test.zip', dsym)
      const payload = compressed.asMultipartPayload()

      const eventContent = payload.content.get('event')
      expect(eventContent).toBeDefined()
      expect(eventContent?.type).toBe('string')

      const metadata = JSON.parse((eventContent as any).value)
      expect(metadata.type).toBe('ios_symbols')
      expect(metadata.uuids).toBe('ABC123-DEF456-789012')
      expect(metadata.git_repository_url).toBeUndefined()
      expect(metadata.git_commit_sha).toBeUndefined()
    })

    test('Should include repository blob in multipart payload when gitRepositoryPayload is provided', () => {
      const dsym: Dsym = {
        bundle: '/path/to/test.dSYM',
        dwarf: [
          {
            object: '/path/to/test.dSYM/Contents/Resources/DWARF/test',
            uuid: 'ABC123-DEF456-789012',
            arch: 'arm64',
          },
        ],
      }

      const repositoryBlob = JSON.stringify({
        version: 1,
        data: [
          {
            repository_url: 'https://github.com/DataDog/dd-sdk-ios',
            hash: 'abc123def456789',
            files: ['src/AppDelegate.swift', 'src/ViewController.swift'],
          },
        ],
      })

      const gitData: GitData = {
        gitRepositoryURL: 'https://github.com/DataDog/dd-sdk-ios',
        gitCommitSha: 'abc123def456789',
        gitRepositoryPayload: repositoryBlob,
      }

      const compressed = new CompressedDsym('/tmp/test.zip', dsym)
      compressed.gitData = gitData

      const payload = compressed.asMultipartPayload()

      // Check repository blob is included in multipart payload
      const repositoryContent = payload.content.get('repository')
      expect(repositoryContent).toBeDefined()
      expect(repositoryContent?.type).toBe('string')

      expect((repositoryContent as any).options?.contentType).toBe('application/json')
      expect((repositoryContent as any).options?.filename).toBe('repository')

      const repositoryData = JSON.parse((repositoryContent as any).value)
      expect(repositoryData.version).toBe(1)
      expect(repositoryData.data).toHaveLength(1)
      expect(repositoryData.data[0].repository_url).toBe('https://github.com/DataDog/dd-sdk-ios')
      expect(repositoryData.data[0].hash).toBe('abc123def456789')
      expect(repositoryData.data[0].files).toEqual(['src/AppDelegate.swift', 'src/ViewController.swift'])

      // Check metadata still includes git information
      const eventContent = payload.content.get('event')
      expect(eventContent).toBeDefined()
      const metadata = JSON.parse((eventContent as any).value)
      expect(metadata.git_repository_url).toBe('https://github.com/DataDog/dd-sdk-ios')
      expect(metadata.git_commit_sha).toBe('abc123def456789')
    })

    test('Should not include repository blob when gitRepositoryPayload is not provided', () => {
      const dsym: Dsym = {
        bundle: '/path/to/test.dSYM',
        dwarf: [
          {
            object: '/path/to/test.dSYM/Contents/Resources/DWARF/test',
            uuid: 'ABC123-DEF456-789012',
            arch: 'arm64',
          },
        ],
      }

      const gitData: GitData = {
        gitRepositoryURL: 'https://github.com/DataDog/dd-sdk-ios',
        gitCommitSha: 'abc123def456789',
        // No gitRepositoryPayload
      }

      const compressed = new CompressedDsym('/tmp/test.zip', dsym)
      compressed.gitData = gitData

      const payload = compressed.asMultipartPayload()

      // Repository blob should not be included
      const repositoryContent = payload.content.get('repository')
      expect(repositoryContent).toBeUndefined()

      // But metadata should still include git URL and SHA
      const eventContent = payload.content.get('event')
      const metadata = JSON.parse((eventContent as any).value)
      expect(metadata.git_repository_url).toBe('https://github.com/DataDog/dd-sdk-ios')
      expect(metadata.git_commit_sha).toBe('abc123def456789')
    })
  })
})
