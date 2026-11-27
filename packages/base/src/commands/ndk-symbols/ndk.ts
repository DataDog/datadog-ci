import fs from 'fs'

import type {NdkArch} from './interfaces'

import upath from 'upath'

import {FileReader} from '@datadog/datadog-ci-base/helpers/filereader'

import {getSectionInfo, readElfHeader, readElfSectionHeaderTable} from '../elf-symbols/elf'
import {ElfClass, ElfFileType, MachineType, SectionHeaderType} from '../elf-symbols/elf-constants'

// The ELF machine types of the Android ABIs, the architecture names the backend expects for them,
// and the ELF class each one must have.
const ANDROID_ARCHS = new Map<number, {arch: NdkArch; elfClass: ElfClass}>([
  [MachineType.EM_ARM, {arch: 'arm', elfClass: ElfClass.ELFCLASS32}], // armeabi-v7a
  [MachineType.EM_AARCH64, {arch: 'arm64', elfClass: ElfClass.ELFCLASS64}], // arm64-v8a
  [MachineType.EM_386, {arch: 'x86', elfClass: ElfClass.ELFCLASS32}], // x86
  [MachineType.EM_X86_64, {arch: 'x64', elfClass: ElfClass.ELFCLASS64}], // x86_64
])

export type NativeLibraryInfo = {
  path: string
  // The name the library is loaded with, which is also how native crash frames show it.
  filename: string
  // Set when the file is an Android native library.
  arch?: NdkArch
  // Set when the file was read but isn't an Android native library.
  notALibraryReason?: string
  // Set when the file couldn't be read at all (permissions, too many open files...).
  readError?: string
  hasSymbols: boolean
  // False for debug-only copies, such as `objcopy --only-keep-debug` output, which aren't the library itself.
  hasCode: boolean
}

/**
 * Reads what's needed to upload an Android native library as an NDK symbol file:
 * its architecture, from the ELF header, and whether it still has symbols (a symbol table or debug info).
 */
export const readNativeLibraryInfo = async (path: string): Promise<NativeLibraryInfo> => {
  const info: NativeLibraryInfo = {path, filename: upath.basename(path), hasSymbols: false, hasCode: false}

  let fileHandle: fs.promises.FileHandle | undefined
  try {
    fileHandle = await fs.promises.open(path, 'r')
    const reader = new FileReader(fileHandle)
    const {isElf, elfHeader, error} = await readElfHeader(reader)
    if (!isElf) {
      info.notALibraryReason = 'not an ELF file'

      return info
    }
    if (error || !elfHeader) {
      info.notALibraryReason = `invalid ELF file (${error?.message ?? 'no header'})`

      return info
    }
    if ((elfHeader.e_type as ElfFileType) !== ElfFileType.ET_DYN) {
      info.notALibraryReason = 'not a shared library'

      return info
    }
    if (!elfHeader.littleEndian) {
      info.notALibraryReason = 'big-endian, while Android libraries are little-endian'

      return info
    }
    const androidArch = ANDROID_ARCHS.get(elfHeader.e_machine)
    if (androidArch === undefined) {
      info.notALibraryReason = `not an Android architecture (ELF machine type ${elfHeader.e_machine})`

      return info
    }
    if (androidArch.elfClass !== elfHeader.elfClass) {
      info.notALibraryReason = `invalid ELF file (${androidArch.arch} with the wrong 32/64-bit class)`

      return info
    }

    const sectionHeaders = await readElfSectionHeaderTable(reader, elfHeader)
    // The symbol table is found by its type, so it doesn't depend on section names.
    const hasSymbolTable = sectionHeaders.some(
      (section) => section.sh_type === SectionHeaderType.SHT_SYMTAB && section.sh_size > BigInt(0)
    )
    const {hasDebugInfo, hasCode} = getSectionInfo(sectionHeaders)
    info.arch = androidArch.arch
    info.hasSymbols = hasSymbolTable || hasDebugInfo
    info.hasCode = hasCode
  } catch (error) {
    info.arch = undefined
    // System errors (from opening or reading the file) mean the file couldn't be checked at all,
    // others mean its content is broken, e.g. truncated.
    if (typeof (error as NodeJS.ErrnoException)?.syscall === 'string') {
      info.readError = (error as Error).message
    } else {
      info.notALibraryReason = `invalid ELF file (${(error as Error).message})`
    }
  } finally {
    await fileHandle?.close()
  }

  return info
}
