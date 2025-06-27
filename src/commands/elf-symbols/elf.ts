import {createHash} from 'crypto'
import fs from 'fs'

import {createReadFunctions, FileReader} from '../../helpers/filereader'
import {execute} from '../../helpers/utils'

import {
  MACHINE_TYPES_DESCRIPTION,
  ELF_TYPES_DESCRIPTION,
  ElfFileType,
  MachineType,
  SectionHeaderType,
  ElfClass,
  NoteType,
} from './elf-constants'

export type ElfFileMetadata = {
  filename: string
  isElf: boolean
  arch: string
  littleEndian: boolean
  elfClass: number
  gnuBuildId: string
  goBuildId: string
  fileHash: string
  elfType: string
  hasDebugInfo: boolean
  hasDynamicSymbolTable: boolean
  hasSymbolTable: boolean
  hasCode: boolean
  error?: Error
}

export type ElfHeader = {
  elfClass: number
  data: number
  elfVersion: number
  abi: number
  abiVersion: number
  littleEndian: boolean

  e_type: number
  e_machine: number
  e_version: number
  e_entry: bigint
  e_phoff: bigint
  e_shoff: bigint
  e_flags: number
  e_ehsize: number
  e_phentsize: number
  e_phnum: number
  e_shentsize: number
  e_shnum: number
  e_shstrndx: number
}

export type ProgramHeader = {
  p_type: number
  p_flags: number
  p_offset: bigint
  p_vaddr: bigint
  p_paddr: bigint
  p_filesz: bigint
  p_memsz: bigint
  p_align: bigint
}

export type SectionHeader = {
  name: string

  sh_name: number
  sh_type: number
  sh_flags: bigint
  sh_addr: bigint
  sh_offset: bigint
  sh_size: bigint
  sh_link: number
  sh_info: number
  sh_addralign: bigint
  sh_entsize: bigint
}

export interface Reader {
  read(length: number, position?: number): Promise<Buffer>
  close(): Promise<void>
}

export interface StringTable {
  [index: number]: string
}

export type ElfResult = {
  isElf: boolean
  elfHeader?: ElfHeader
  error?: Error
}

const SUPPORTED_ARCHS = [
  MACHINE_TYPES_DESCRIPTION[MachineType.EM_AARCH64],
  MACHINE_TYPES_DESCRIPTION[MachineType.EM_X86_64],
  MACHINE_TYPES_DESCRIPTION[MachineType.EM_ARM],
]
const SUPPORTED_ELF_TYPES = [ELF_TYPES_DESCRIPTION[ElfFileType.ET_DYN], ELF_TYPES_DESCRIPTION[ElfFileType.ET_EXEC]]

const getBFDTargetForArch = (arch: string, littleEndian: boolean, elfClass: number): string => {
  if (arch === MACHINE_TYPES_DESCRIPTION[MachineType.EM_X86_64]) {
    return `elf${elfClass}-x86-64`
  }

  return `elf${elfClass}-${littleEndian ? 'little' : 'big'}${arch}`
}

const getGenericBFDTargetForArch = (_arch: string, littleEndian: boolean, elfClass: number): string => {
  return `elf${elfClass}-${littleEndian ? 'little' : 'big'}`
}

// Read the first 24 bytes of the file to get the ELF header (up to and including e_version field)
const getElfHeaderStart = async (filename: string): Promise<Buffer> => {
  const fd = await fs.promises.open(filename, 'r')
  const buffer = Buffer.alloc(24)
  await fd.read(buffer, 0, 24, 0)
  await fd.close()

  return buffer
}

export const readElfHeader = async (reader: Reader): Promise<ElfResult> => {
  const result: ElfResult = {isElf: false}

  try {
    const IDENT_SIZE = 16
    const identBuffer = await reader.read(IDENT_SIZE)

    // check magic number:  0x7F followed by 'ELF' in ASCII
    if (identBuffer.toString('hex', 0, 4) !== '7f454c46') {
      return result
    }

    result.isElf = true

    const elfClass = identBuffer.readUint8(4)
    const data = identBuffer.readUint8(5)
    const elfVersion = identBuffer.readUint8(6)
    const abi = identBuffer.readUint8(7)
    const abiVersion = identBuffer.readUint8(8)

    if (elfClass !== ElfClass.ELFCLASS32 && elfClass !== ElfClass.ELFCLASS64) {
      throw new Error(`Not a valid ELF file. Class '${elfClass}' is invalid.`)
    }

    if (data < 1 || data > 2) {
      throw new Error(`Not a valid ELF file. Endianness '${data}' is invalid`)
    }

    const littleEndian = data === 1

    if (elfVersion !== 1) {
      throw new Error(`Not a valid ELF file. Version '${elfVersion}' is invalid`)
    }

    const headerSize = elfClass === 1 ? 52 : 64
    const headerSizeLeft = headerSize - IDENT_SIZE
    const headerBuffer = await reader.read(headerSizeLeft, IDENT_SIZE)

    const {readUInt32, readUInt16, readBigUInt32Or64} = createReadFunctions(
      headerBuffer,
      littleEndian,
      elfClass === ElfClass.ELFCLASS32
    )

    const type = readUInt16()
    const machine = readUInt16()
    const version = readUInt32()

    if (version !== 1) {
      throw new Error(`Not a valid ELF file. Version '${version}' is invalid`)
    }

    const entry = readBigUInt32Or64()
    const phoff = readBigUInt32Or64()
    const shoff = readBigUInt32Or64()
    const flags = readUInt32()
    const ehsize = readUInt16()
    const phentsize = readUInt16()
    const phnum = readUInt16()
    const shentsize = readUInt16()
    const shnum = readUInt16()
    const shstrndx = readUInt16()

    if ((elfClass === 1 && ehsize !== 0x34) || (elfClass === 2 && ehsize !== 0x40)) {
      throw Error(`Invalid ELF file. Unexpected header size '${ehsize}'`)
    }

    result.elfHeader = {
      // e_indent content
      elfClass,
      data,
      elfVersion,
      abi,
      abiVersion,
      littleEndian,

      e_type: type,
      e_machine: machine,
      e_version: version,
      e_entry: entry,
      e_phoff: phoff,
      e_shoff: shoff,
      e_flags: flags,
      e_ehsize: ehsize,
      e_phentsize: phentsize,
      e_phnum: phnum,
      e_shentsize: shentsize,
      e_shnum: shnum,
      e_shstrndx: shstrndx,
    }
  } catch (error) {
    result.error = error
  }

  return result
}

export const readElfSectionHeader = async (
  reader: Reader,
  elfHeader: ElfHeader,
  index: number
): Promise<SectionHeader> => {
  const buf = await reader.read(elfHeader.e_shentsize, Number(elfHeader.e_shoff) + index * elfHeader.e_shentsize)

  const {readUInt32, readBigUInt32Or64} = createReadFunctions(
    buf,
    elfHeader.littleEndian,
    elfHeader.elfClass === ElfClass.ELFCLASS32
  )

  return {
    name: '',
    sh_name: readUInt32(),
    sh_type: readUInt32(),
    sh_flags: readBigUInt32Or64(),
    sh_addr: readBigUInt32Or64(),
    sh_offset: readBigUInt32Or64(),
    sh_size: readBigUInt32Or64(),
    sh_link: readUInt32(),
    sh_info: readUInt32(),
    sh_addralign: readBigUInt32Or64(),
    sh_entsize: readBigUInt32Or64(),
  }
}

export const readElfSectionHeaderTable = async (reader: Reader, elfHeader: ElfHeader): Promise<SectionHeader[]> => {
  if (elfHeader.e_shnum === 0) {
    return []
  }

  const sectionHeaders = new Array<SectionHeader>(elfHeader.e_shnum)
  for (let i = 0; i < elfHeader.e_shnum; i++) {
    sectionHeaders[i] = await readElfSectionHeader(reader, elfHeader, i)
  }

  // add section names
  if (
    elfHeader.e_shstrndx < sectionHeaders.length &&
    sectionHeaders[elfHeader.e_shstrndx].sh_type === SectionHeaderType.SHT_STRTAB
  ) {
    const shstrtab = sectionHeaders[elfHeader.e_shstrndx]
    const buf = await reader.read(Number(shstrtab.sh_size), Number(shstrtab.sh_offset))
    for (const sectionHeader of sectionHeaders) {
      const nameOffset = sectionHeader.sh_name
      if (nameOffset < buf.length) {
        const nullByteOffset = buf.indexOf(0, nameOffset)
        sectionHeader.name = buf.toString('ascii', nameOffset, nullByteOffset)
      }
    }
  }

  return sectionHeaders
}

export const readElfProgramHeader = async (
  reader: Reader,
  elfHeader: ElfHeader,
  index: number
): Promise<ProgramHeader> => {
  const buf = await reader.read(elfHeader.e_phentsize, Number(elfHeader.e_phoff) + index * elfHeader.e_phentsize)

  const {readUInt32, readBigUInt32Or64} = createReadFunctions(
    buf,
    elfHeader.littleEndian,
    elfHeader.elfClass === ElfClass.ELFCLASS32
  )

  if (elfHeader.elfClass === ElfClass.ELFCLASS32) {
    return {
      p_type: readUInt32(),
      p_offset: readBigUInt32Or64(),
      p_vaddr: readBigUInt32Or64(),
      p_paddr: readBigUInt32Or64(),
      p_filesz: readBigUInt32Or64(),
      p_memsz: readBigUInt32Or64(),
      p_flags: readUInt32(),
      p_align: readBigUInt32Or64(),
    }
  } else {
    return {
      p_type: readUInt32(),
      p_flags: readUInt32(),
      p_offset: readBigUInt32Or64(),
      p_vaddr: readBigUInt32Or64(),
      p_paddr: readBigUInt32Or64(),
      p_filesz: readBigUInt32Or64(),
      p_memsz: readBigUInt32Or64(),
      p_align: readBigUInt32Or64(),
    }
  }
}

export const readElfProgramHeaderTable = async (reader: Reader, elfHeader: ElfHeader): Promise<ProgramHeader[]> => {
  if (elfHeader.e_phnum === 0) {
    return []
  }

  const programHeaders = new Array<ProgramHeader>(elfHeader.e_phnum)
  for (let i = 0; i < elfHeader.e_phnum; i++) {
    programHeaders[i] = await readElfProgramHeader(reader, elfHeader, i)
  }

  return programHeaders
}

const readElfNote = async (reader: Reader, sectionHeader: SectionHeader, elfHeader: ElfHeader) => {
  const buf = await reader.read(Number(sectionHeader.sh_size), Number(sectionHeader.sh_offset))
  // read elf note header
  const {readUInt32} = createReadFunctions(buf, elfHeader.littleEndian, elfHeader.elfClass === ElfClass.ELFCLASS32)
  const namesz = readUInt32()
  const descsz = readUInt32()
  const type = readUInt32()
  const name = buf.toString('ascii', 12, 12 + namesz)
  const align = Number(sectionHeader.sh_addralign)
  const descOffset = 12 + namesz
  // align to descOffset to `align` bytes without division
  const alignedDescOffset = descOffset + ((align - (descOffset % align)) % align)
  const desc = buf.subarray(alignedDescOffset, alignedDescOffset + descsz)

  return {type, name, desc}
}

export const getBuildIds = async (
  reader: Reader,
  sectionHeaders: SectionHeader[],
  elfHeader: ElfHeader
): Promise<{gnuBuildId: string; goBuildId: string}> => {
  let gnuBuildId = ''
  let goBuildId = ''
  const gnuBuildIdSection = sectionHeaders.find(
    (section) => section.sh_type === SectionHeaderType.SHT_NOTE && section.name === '.note.gnu.build-id'
  )
  if (gnuBuildIdSection) {
    const {type, name, desc} = await readElfNote(reader, gnuBuildIdSection, elfHeader)
    if (type === NoteType.NT_GNU_BUILD_ID || name === 'GNU') {
      gnuBuildId = desc.toString('hex')
    }
  }
  const goBuildIdSection = sectionHeaders.find(
    (section) => section.sh_type === SectionHeaderType.SHT_NOTE && section.name === '.note.go.buildid'
  )
  if (goBuildIdSection) {
    const {type, name, desc} = await readElfNote(reader, goBuildIdSection, elfHeader)
    if (type === NoteType.NT_GO_BUILD_ID || name === 'Go') {
      goBuildId = desc.toString('ascii')
    }
  }

  return {gnuBuildId, goBuildId}
}

export const isSupportedArch = (arch: string): boolean => {
  return SUPPORTED_ARCHS.includes(arch)
}

export const isSupportedElfType = (type: string): boolean => {
  return SUPPORTED_ELF_TYPES.includes(type)
}

export const hasNonEmptySection = (sectionHeaders: SectionHeader[], name: string): boolean => {
  return sectionHeaders.some((section) => section.name === name && section.sh_type !== SectionHeaderType.SHT_NOBITS)
}

export const getSectionInfo = (
  sections: SectionHeader[]
): {hasDebugInfo: boolean; hasSymbolTable: boolean; hasDynamicSymbolTable: boolean; hasCode: boolean} => {
  const hasDebugInfo = hasNonEmptySection(sections, '.debug_info') || hasNonEmptySection(sections, '.zdebug_info')
  const hasSymbolTable = hasNonEmptySection(sections, '.symtab')
  const hasDynamicSymbolTable = hasNonEmptySection(sections, '.dynsym')
  const hasCode = sections.some(
    (section) => section.name === '.text' && section.sh_type === SectionHeaderType.SHT_PROGBITS
  )

  return {hasDebugInfo, hasSymbolTable, hasDynamicSymbolTable, hasCode}
}

export const getElfFileMetadata = async (filename: string): Promise<ElfFileMetadata> => {
  const metadata: ElfFileMetadata = {
    filename,
    isElf: false,
    littleEndian: false,
    elfClass: 0,
    arch: '',
    gnuBuildId: '',
    goBuildId: '',
    fileHash: '',
    elfType: '',
    hasDebugInfo: false,
    hasSymbolTable: false,
    hasDynamicSymbolTable: false,
    hasCode: false,
  }

  let fileHandle: fs.promises.FileHandle | undefined
  try {
    fileHandle = await fs.promises.open(filename, 'r')
    const reader = new FileReader(fileHandle)
    const {isElf, elfHeader, error} = await readElfHeader(reader)

    if (isElf) {
      metadata.littleEndian = elfHeader!.littleEndian
      metadata.elfClass = elfHeader!.elfClass === ElfClass.ELFCLASS64 ? 64 : 32
      metadata.arch = MACHINE_TYPES_DESCRIPTION[elfHeader!.e_machine as MachineType]
      metadata.elfType = ELF_TYPES_DESCRIPTION[elfHeader!.e_type as ElfFileType]
    }
    metadata.error = error
    metadata.isElf = isElf

    if (!isElf || error || !isSupportedArch(metadata.arch) || !isSupportedElfType(metadata.elfType)) {
      return metadata
    }

    const sectionHeaders = await readElfSectionHeaderTable(reader, elfHeader!)
    const {gnuBuildId, goBuildId} = await getBuildIds(reader, sectionHeaders, elfHeader!)
    const {hasDebugInfo, hasSymbolTable, hasDynamicSymbolTable, hasCode} = getSectionInfo(sectionHeaders)
    let fileHash = ''
    if (hasCode) {
      // Only compute file hash if the file has code:
      // if the file has no code, it is likely a debug info file and its hash is useless
      fileHash = await computeFileHash(filename)
    }
    Object.assign(metadata, {
      fileHash,
      gnuBuildId,
      goBuildId,
      hasDebugInfo,
      hasSymbolTable,
      hasDynamicSymbolTable,
      hasCode,
    })
  } catch (error) {
    metadata.error = error
  } finally {
    if (fileHandle) {
      await fileHandle.close()
    }
  }

  return metadata
}

// Compute a file hash as SHA256 checksum of the first and last 4096 bytes of the file
// and the file size represented as a big endian uint64. Only the first 16 bytes (128 bits)
// of the hash are used.
export const computeFileHash = async (filename: string): Promise<string> => {
  const fd = await fs.promises.open(filename, 'r')
  try {
    const stats = await fd.stat()
    const fileSize = stats.size
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(4096)
    let {bytesRead} = await fd.read(buffer, 0, 4096)
    hash.update(buffer.slice(0, bytesRead))
    ;({bytesRead} = await fd.read(buffer, 0, 4096, Math.max(0, fileSize - 4096)))
    hash.update(buffer.slice(0, bytesRead))

    buffer.writeBigUInt64BE(BigInt(fileSize), 0)
    hash.update(buffer.slice(0, 8))

    return hash.digest('hex').slice(0, 32)
  } finally {
    await fd.close()
  }
}

const hasZstdSupport = async (): Promise<boolean> => {
  const {stdout} = await execute('objcopy --help')

  return /--compress-debug-sections.*zstd/.test(stdout.toString())
}

const memoize = <T>(fn: () => Promise<T>): (() => Promise<T>) => {
  let promise: Promise<T> | undefined

  return () => (promise = promise || fn())
}

const hasZstdSupportCached = memoize(hasZstdSupport)

const getSupportedBfdTargets = async (): Promise<string[]> => {
  const {stdout} = await execute('objcopy --help')

  const groups = /supported targets: (?<targets>.*)$/m.exec(stdout.toString())?.groups
  if (groups) {
    return groups.targets.split(/\s+/)
  }

  return []
}

const getSupportedBfdTargetsCached = memoize(getSupportedBfdTargets)

const replaceElfHeader = async (targetFilename: string, sourceFilename: string): Promise<void> => {
  const sourceElfHeader = await getElfHeaderStart(sourceFilename)
  const fd2 = await fs.promises.open(targetFilename, 'r+')
  await fd2.write(sourceElfHeader, 0, sourceElfHeader.length, 0)
  await fd2.close()
}

export const copyElfDebugInfo = async (
  filename: string,
  outputFile: string,
  elfFileMetadata: ElfFileMetadata,
  compressDebugSections: boolean
): Promise<void> => {
  const supportedTargets = await getSupportedBfdTargetsCached()

  let bfdTargetOption = ''
  const bfdTarget = getBFDTargetForArch(elfFileMetadata.arch, elfFileMetadata.littleEndian, elfFileMetadata.elfClass)
  if (!supportedTargets.includes(bfdTarget)) {
    // To be able to use `objcopy` on a file with a different architecture than the host, we need to give the BFD target
    const genericBfdTarget = getGenericBFDTargetForArch(
      elfFileMetadata.arch,
      elfFileMetadata.littleEndian,
      elfFileMetadata.elfClass
    )
    bfdTargetOption = `-I ${genericBfdTarget}`
  }

  let compressDebugSectionsOption = ''
  if (compressDebugSections) {
    compressDebugSectionsOption = '--compress-debug-sections'
    if (await hasZstdSupportCached()) {
      compressDebugSectionsOption += '=zstd'
    }
  }

  const keepDynamicSymbolTable =
    elfFileMetadata.hasDynamicSymbolTable && !elfFileMetadata.hasSymbolTable && !elfFileMetadata.hasDebugInfo

  // Remove .gdb_index section as it is not needed and can be quite big
  let options = `${bfdTargetOption} --only-keep-debug ${compressDebugSectionsOption} --remove-section=.gdb_index`

  if (keepDynamicSymbolTable) {
    // If the file has only a dynamic symbol table, preserve the sections needed by symbolic to create a symcache
    const sectionsToKeep = ['.dynsym', '.dynstr', '.dynamic', '.hash', '.gnu.hash', '.gnu.version*', '.rel*']
    options += ' ' + sectionsToKeep.map((section) => `--set-section-flags ${section}=alloc,readonly,contents`).join(' ')
  }

  await execute(`objcopy ${options} ${filename} ${outputFile}`)

  if (bfdTargetOption) {
    // Replace the ELF header in the extracted debug info file with the one from the initial file to keep the original architecture
    await replaceElfHeader(outputFile, filename)
  }
}

export const getOutputFilenameFromBuildId = (buildId: string): string => {
  // Go build id may contain slashes, replace them with dashes so it can be used as a filename
  return buildId.replace(/\//g, '-')
}

export const getBuildIdWithArch = (fileMetadata: ElfFileMetadata): string => {
  return (fileMetadata.gnuBuildId || fileMetadata.goBuildId || fileMetadata.fileHash) + '-' + fileMetadata.arch
}
