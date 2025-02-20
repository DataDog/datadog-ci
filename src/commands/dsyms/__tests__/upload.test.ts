import {existsSync, promises} from 'fs'
import {EOL, platform} from 'os'
import path from 'path'

import {Cli} from 'clipanion/lib/advanced'
import glob from 'glob'

import * as APIKeyHelpers from '../../../helpers/apikey'
import {buildPath} from '../../../helpers/utils'

import {Dsym} from '../interfaces'
import {UploadCommand} from '../upload'
import {createUniqueTmpDirectory, deleteDirectory} from '../utils'

/**
 * `dwarfdump` and `lipo` are only available in macOS, so we mock their behaviour when running tests on other platforms.
 */
const mockDwarfdumpAndLipoIfNotMacOS = () => {
  if (platform() !== 'darwin') {
    // For `dwarfdump --uuid` mock, return the same output as the command would give on macOS:
    require('../utils').executeDwarfdump = jest.fn().mockImplementation((dsymPath: string) => {
      let fixture = dsymPath.includes('multiple-archs') ? fatDSYMFixture : undefined
      fixture = fixture ?? (dsymPath.includes('single-arch') ? slimDSYMFixture : undefined)

      if (fixture !== undefined) {
        const outputLines = fixture.slices.map((slice) => {
          const objectPathInDsym = path.relative(fixture!.bundlePath, slice.objectPath)
          const objectPathInMockedDSYM = buildPath(dsymPath, objectPathInDsym)

          return `UUID: ${slice.uuid} (${slice.arch}) ${objectPathInMockedDSYM}`
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
  bundlePath: 'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM',
  slices: [
    {
      arch: 'armv7',
      objectPath:
        'src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest',
      uuid: 'C8469F85-B060-3085-B69D-E46C645560EA',
    },
    {
      arch: 'arm64',
      objectPath:
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
  bundlePath: 'src/commands/dsyms/__tests__/fixtures/single-arch/DDTest.framework.dSYM',
  slices: [
    {
      arch: 'arm64',
      objectPath:
        'src/commands/dsyms/__tests__/fixtures/single-arch/DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest',
      uuid: '3BC12422-63CC-30E8-B916-E5006CE3286C',
    },
  ],
}

describe('upload', () => {
  beforeAll(() => {
    mockDwarfdumpAndLipoIfNotMacOS()
  })

  describe('findDSYMsInDirectory', () => {
    const command = new UploadCommand()

    test('Should find dSYMs recursively', async () => {
      const expectedDSYMs = [fatDSYMFixture, slimDSYMFixture]

      const actualDSYMs = await command['findDSYMsInDirectory']('src/commands/dsyms/__tests__/fixtures')

      expect(actualDSYMs.length).toEqual(2)
      expect(actualDSYMs).toContainEqual(expectedDSYMs[0])
      expect(actualDSYMs).toContainEqual(expectedDSYMs[1])
    })
  })

  describe('parseDwarfdumpOutput', () => {
    const command = new UploadCommand()

    test('Should read arch slice from single-line output', () => {
      const output = 'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo'

      const slices = command['parseDwarfdumpOutput'](output)
      expect(slices).toEqual([
        {
          arch: 'arm64',
          objectPath: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
      ])
    })

    test('Should read arch slices from multi-line output', () => {
      const output =
        'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n' +
        'UUID: AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE (x86_64) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n' +
        'UUID: FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF (armv7) /folder/Foo.dSYM/Contents/Resources/DWARF/Foo\n'

      const slices = command['parseDwarfdumpOutput'](output)
      expect(slices).toEqual([
        {
          arch: 'arm64',
          objectPath: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
        {
          arch: 'x86_64',
          objectPath: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        },
        {
          arch: 'armv7',
          objectPath: '/folder/Foo.dSYM/Contents/Resources/DWARF/Foo',
          uuid: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
        },
      ])
    })

    test('Should read arch slice if object path contains whitespaces', () => {
      const output =
        'UUID: 00000000-1111-2222-3333-444444444444 (arm64) /folder with whitespaces/Foo Bar.dSYM/Contents/Resources/DWARF/Foo Bar'

      const slices = command['parseDwarfdumpOutput'](output)
      expect(slices).toEqual([
        {
          arch: 'arm64',
          objectPath: '/folder with whitespaces/Foo Bar.dSYM/Contents/Resources/DWARF/Foo Bar',
          uuid: '00000000-1111-2222-3333-444444444444',
        },
      ])
    })

    test('Should read no arch slices from invalid output', () => {
      const slices = command['parseDwarfdumpOutput']('')
      expect(slices).toEqual([])
    })
  })

  describe('thinDSYMs', () => {
    const command = new UploadCommand()

    test('Given fat dSYM, it should extract each arch slice to separate dSYM in target folder', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()

      // Given
      const inputDSYM = fatDSYMFixture
      expect(inputDSYM.slices.length).toBeGreaterThan(1)

      // When
      const extractedDSYMs = await command['thinDSYMs']([inputDSYM], tmpDirectory)

      // Then
      expect(extractedDSYMs.length).toEqual(inputDSYM.slices.length)
      inputDSYM.slices.forEach((slice) => {
        expect(extractedDSYMs).toContainEqual({
          bundlePath: `${buildPath(tmpDirectory, slice.uuid)}.dSYM`,
          slices: [
            {
              arch: slice.arch,
              objectPath: `${buildPath(tmpDirectory, slice.uuid)}.dSYM/Contents/Resources/DWARF/DDTest`,
              uuid: slice.uuid,
            },
          ],
        })
      })
      const objectFilesInTargetFolder = glob.sync(buildPath(tmpDirectory, '**/Contents/Resources/DWARF/DDTest'))
      expect(objectFilesInTargetFolder.length).toEqual(inputDSYM.slices.length)

      await deleteDirectory(tmpDirectory)
    })

    test('Given slim dSYM, it should leave it untouched and not extract anything into target folder', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()

      // Given
      const inputDSYM = slimDSYMFixture
      expect(inputDSYM.slices.length).toEqual(1)

      // When
      const extractedDSYMs = await command['thinDSYMs']([inputDSYM], tmpDirectory)

      // Then
      expect(extractedDSYMs).toEqual([inputDSYM])
      const filesInTargetFolder = glob.sync(buildPath(tmpDirectory, '*'))
      expect(filesInTargetFolder.length).toEqual(0)

      await deleteDirectory(tmpDirectory)
    })
  })

  describe('compressDSYMsToDirectory', () => {
    const command = new UploadCommand()

    test('Should archive dSYMs to target directory and name archives by their UUIDs', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()
      const dsymFixtures = [fatDSYMFixture, slimDSYMFixture]

      // When
      const compressedDSYMs = await command['compressDSYMsToDirectory'](dsymFixtures, tmpDirectory)

      // Then
      expect(compressedDSYMs[0].dsym).toEqual(dsymFixtures[0])
      expect(compressedDSYMs[0].archivePath).toEqual(buildPath(tmpDirectory, `${dsymFixtures[0].slices[0].uuid}.zip`))
      expect(existsSync(compressedDSYMs[0].archivePath)).toBeTruthy()

      expect(compressedDSYMs[1].dsym).toEqual(dsymFixtures[1])
      expect(compressedDSYMs[1].archivePath).toEqual(buildPath(tmpDirectory, `${dsymFixtures[1].slices[0].uuid}.zip`))
      expect(existsSync(compressedDSYMs[1].archivePath)).toBeTruthy()

      await deleteDirectory(tmpDirectory)
    })
  })
})

describe('execute', () => {
  const makeCli = () => {
    const cli = new Cli()
    cli.register(UploadCommand)

    return cli
  }

  const createMockContext = () => {
    let data = ''

    return {
      stdout: {
        toString: () => data,
        write: (input: string) => {
          data += input
        },
      },
    }
  }

  const runCLI = async (dsymPath: string, options?: {configPath?: string; env?: Record<string, string>}) => {
    const cli = makeCli()
    const context = createMockContext() as any
    const command = ['dsyms', 'upload', dsymPath, '--dry-run']
    if (options?.configPath) {
      command.push('--config')
      command.push(options.configPath)
    } else {
      process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
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

  afterEach(() => {
    delete process.env.DATADOG_API_KEY
    delete process.env.DATADOG_SITE
  })

  test('Should succeed with folder input', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/')
    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)

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
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[7]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )
    expect(output[8]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[11]).toContain('Handled 3 dSYMs with success')
  })

  test('Should succeed with zip file input', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/all.zip')
    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)

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
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[7]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )
    expect(output[8]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[11]).toContain('Handled 3 dSYMs with success')
  })

  test('Should succeed with API key and site from datadog.json file', async () => {
    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/', {
      configPath: 'src/commands/dsyms/__tests__/fixtures/datadog-ci.json',
    })
    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)

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
      'Uploading C8469F85-B060-3085-B69D-E46C645560EA.zip (DDTest, arch: armv7, UUID: C8469F85-B060-3085-B69D-E46C645560EA)'
    )
    expect(output[7]).toContain(
      'Uploading 06EE3D68-D605-3E92-B92D-2F48C02A505E.zip (DDTest, arch: arm64, UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E)'
    )
    expect(output[8]).toContain(
      'Uploading 3BC12422-63CC-30E8-B916-E5006CE3286C.zip (DDTest, arch: arm64, UUID: 3BC12422-63CC-30E8-B916-E5006CE3286C)'
    )
    expect(output[11]).toContain('Handled 3 dSYMs with success')
  })

  test('Should use API Key from env over config from JSON file', async () => {
    const apiKeyValidatorSpy = jest.spyOn(APIKeyHelpers, 'newApiKeyValidator')

    const {context, code} = await runCLI('src/commands/dsyms/__tests__/fixtures/', {
      configPath: 'src/commands/dsyms/__tests__/fixtures/datadog-ci.json',
      env: {
        DATADOG_API_KEY: 'env_API_key',
        DATADOG_SITE: 'us3.datadoghq.com',
      },
    })

    const outputString = context.stdout.toString()
    const output = outputString.split(EOL)
    expect(code).toBe(0)

    expect(apiKeyValidatorSpy).toHaveBeenCalledWith({
      apiKey: 'env_API_key',
      datadogSite: 'us3.datadoghq.com',
      metricsLogger: expect.anything(),
    })
    expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
    expect(output).toContain('The environment API key ending in _key will be used.')
  })
})
