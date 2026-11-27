import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {readNativeLibraryInfo} from '../ndk'

const fixtureDir = 'src/commands/ndk-symbols/__tests__/fixtures'

describe('readNativeLibraryInfo', () => {
  test.each([
    ['arm64-v8a', 'arm64'],
    ['armeabi-v7a', 'arm'],
    ['x86', 'x86'],
    ['x86_64', 'x64'],
  ])('reads the architecture of a %s library from its ELF header', async (abi, arch) => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/libs/${abi}/libnative.so`)

    expect(info).toEqual({
      path: `${fixtureDir}/libs/${abi}/libnative.so`,
      filename: 'libnative.so',
      arch,
      hasSymbols: true,
      hasCode: true,
    })
  })

  test('detects a stripped library', async () => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/stripped/arm64-v8a/libstripped.so`)

    expect(info.arch).toBe('arm64')
    expect(info.hasSymbols).toBe(false)
    expect(info.hasCode).toBe(true)
  })

  test('counts debug info without a symbol table as symbols', async () => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/debug-only/arm64-v8a/libdebugonly.so`)

    expect(info.arch).toBe('arm64')
    expect(info.hasSymbols).toBe(true)
    expect(info.hasCode).toBe(true)
  })

  test('detects a debug-only copy, which has no code', async () => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/no-code/arm64-v8a/libnocode.so`)

    expect(info.arch).toBe('arm64')
    expect(info.hasSymbols).toBe(true)
    expect(info.hasCode).toBe(false)
  })

  test('rejects a file that is not ELF', async () => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/not-elf/libfake.so`)

    expect(info.arch).toBeUndefined()
    expect(info.notALibraryReason).toBe('not an ELF file')
    expect(info.readError).toBeUndefined()
  })

  test('rejects an ELF file that is not a shared library', async () => {
    const info = await readNativeLibraryInfo('src/commands/elf-symbols/__tests__/fixtures/exec_aarch64')

    expect(info.arch).toBeUndefined()
    expect(info.notALibraryReason).toBe('not a shared library')
  })

  test('rejects a big-endian shared library', async () => {
    const info = await readNativeLibraryInfo(`${fixtureDir}/big-endian/libbigendian.so`)

    expect(info.arch).toBeUndefined()
    expect(info.notALibraryReason).toBe('big-endian, while Android libraries are little-endian')
  })

  test('rejects a truncated ELF file', async () => {
    const info = await readNativeLibraryInfo('src/commands/elf-symbols/__tests__/fixtures/truncated_elf_file')

    expect(info.arch).toBeUndefined()
    expect(info.notALibraryReason).toBeDefined()
    expect(info.readError).toBeUndefined()
  })

  describe('with files made for the test', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'ndk-symbols-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, {recursive: true, force: true})
    })

    test('rejects an architecture with the wrong 32/64-bit class', async () => {
      // A 64-bit arm64 library whose header claims 32-bit ARM (e_machine is at offset 18).
      const path = upath.join(tmpDir, 'libmismatch.so')
      const content = fs.readFileSync(`${fixtureDir}/libs/arm64-v8a/libnative.so`)
      content.writeUInt16LE(40, 18)
      fs.writeFileSync(path, content)

      const info = await readNativeLibraryInfo(path)

      expect(info.arch).toBeUndefined()
      expect(info.notALibraryReason).toBe('invalid ELF file (arm with the wrong 32/64-bit class)')
    })

    test('reports a file that cannot be read as a read error', async () => {
      const path = upath.join(tmpDir, 'libmissing.so')

      const info = await readNativeLibraryInfo(path)

      expect(info.arch).toBeUndefined()
      expect(info.notALibraryReason).toBeUndefined()
      expect(info.readError).toContain('ENOENT')
    })
  })
})
