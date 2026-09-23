/* eslint-disable no-bitwise -- PE records contain packed bit fields. */
import fs from 'fs'

import {
  CV_INFO_PDB_FILENAME_OFFSET,
  DOS_HEADER_LFANEW_OFFSET,
  DOS_HEADER_SIZE,
  IMAGE_DATA_DIRECTORY32_OFFSET,
  IMAGE_DATA_DIRECTORY64_OFFSET,
  IMAGE_DATA_DIRECTORY_SIZE,
  IMAGE_DATA_DIRECTORY_SIZE_OFFSET,
  IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET,
  IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_SIZE,
  IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET,
  IMAGE_DEBUG_TYPE_CODEVIEW,
  IMAGE_DIRECTORY_ENTRY_DEBUG,
  IMAGE_DIRECTORY_ENTRY_EXCEPTION,
  IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG,
  IMAGE_DOS_SIGNATURE,
  IMAGE_FILE_EXECUTABLE_IMAGE,
  IMAGE_FILE_HEADER_CHARACTERISTICS_OFFSET,
  IMAGE_FILE_HEADER_SIZEOFOPTIONALHEADER_OFFSET,
  IMAGE_FILE_LARGE_ADDRESS_AWARE,
  IMAGE_FILE_MACHINE_AMD64,
  IMAGE_FILE_MACHINE_I386,
  IMAGE_LOAD_CONFIG32_CHPE_METADATA_OFFSET,
  IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET,
  IMAGE_NT_HEADERS32_SIZE,
  IMAGE_NT_HEADERS64_SIZE,
  IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET,
  IMAGE_NT_OPTIONAL_HDR32_MAGIC,
  IMAGE_NT_OPTIONAL_HDR64_MAGIC,
  IMAGE_NT_SIGNATURE,
  IMAGE_NUMBEROF_DIRECTORY_ENTRIES,
  IMAGE_OPTIONAL_HEADER64_IMAGEBASE_OFFSET,
  IMAGE_OPTIONAL_HEADER_FILEALIGNMENT_OFFSET,
  IMAGE_OPTIONAL_HEADER_OFFSET,
  IMAGE_OPTIONAL_HEADER_SIZEOFHEADERS_OFFSET,
  IMAGE_OPTIONAL_HEADER_SIZEOFIMAGE_OFFSET,
  IMAGE_OPTIONAL_HEADER_SUBSYSTEM_OFFSET,
  IMAGE_SCN_CNT_CODE,
  IMAGE_SCN_CNT_INITIALIZED_DATA,
  IMAGE_SCN_MEM_EXECUTE,
  IMAGE_SCN_MEM_READ,
  IMAGE_SECTION_HEADER_CHARACTERISTICS_OFFSET,
  IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET,
  IMAGE_SECTION_HEADER_SIZE,
  IMAGE_SECTION_HEADER_SIZEOFRAWDATA_OFFSET,
  IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET,
  IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET,
  IMAGE_SHORT_NAME_SIZE,
  IMAGE_SIZEOF_OPTIONAL_HEADER32,
  IMAGE_SIZEOF_OPTIONAL_HEADER64,
  IMAGE_SUBSYSTEM_WINDOWS_CUI,
  PDB70_SIGNATURE,
  RUNTIME_FUNCTION_BEGIN_OFFSET,
  RUNTIME_FUNCTION_END_OFFSET,
  RUNTIME_FUNCTION_INDIRECT,
  RUNTIME_FUNCTION_SIZE,
  RUNTIME_FUNCTION_UNWIND_OFFSET,
  UNW_FLAG_CHAININFO,
  UNW_FLAG_EHANDLER,
  UNW_FLAG_UHANDLER,
  UNWIND_CODE_OP_OFFSET,
  UNWIND_CODE_SIZE,
  UNWIND_INFO_COUNT_OF_CODES_OFFSET,
  UNWIND_INFO_HEADER_SIZE,
  UNWIND_INFO_VERSION_FLAGS_OFFSET,
  UWOP_ALLOC_LARGE,
  UWOP_EPILOG,
  UWOP_PUSH_MACHFRAME,
  UWOP_SAVE_NONVOL,
  UWOP_SAVE_NONVOL_FAR,
  UWOP_SAVE_XMM128,
  UWOP_SAVE_XMM128_FAR,
  UWOP_SPARE_CODE,
} from './pe-constants'

/**
 * A "reduced PE" is a copy of an x64 EXE/DLL that keeps only what a stack walker needs:
 * module identity, section addresses, the exception table and the unwind records it references.
 * Everything else (code, data, resources, the PDB path...) is left zeroed. Section addresses and
 * file offsets are unchanged, so every RVA inside the kept records stays valid.
 *
 * x86 images have no exception table; their unwind data lives in the PDB, so no reduced PE is built.
 */
export interface ReducedPE {
  architecture: 'x86' | 'x64'
  /** Undefined for x86, where the PDB alone carries the unwind data. */
  data?: Buffer
  functions: number
}

const MAX_PE_HEADER_OFFSET = 4096
const MAX_SECTIONS = 96
const MAX_DEBUG_ENTRIES = 128
const MAX_UNWIND_CHAIN_DEPTH = 64
const REDUCED_PDB_NAME = '_.pdb\0'
const REDUCED_CODEVIEW_SIZE = CV_INFO_PDB_FILENAME_OFFSET + REDUCED_PDB_NAME.length

const requireValid: (condition: boolean, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(`Cannot extract PE unwind data: ${message}`)
  }
}

/** Bounds-checked little-endian reads, so malformed files fail with a clear error. */
class PeReader {
  constructor(public readonly data: Buffer) {}

  public checkRange(offset: number, size: number): void {
    requireValid(
      Number.isSafeInteger(offset) && offset >= 0 && size >= 0 && offset + size <= this.data.length,
      'out-of-bounds record'
    )
  }

  public u8(offset: number): number {
    this.checkRange(offset, 1)

    return this.data.readUInt8(offset)
  }

  public u16(offset: number): number {
    this.checkRange(offset, 2)

    return this.data.readUInt16LE(offset)
  }

  public u32(offset: number): number {
    this.checkRange(offset, 4)

    return this.data.readUInt32LE(offset)
  }
}

interface Section {
  headerOffset: number
  virtualAddress: number
  virtualSize: number
  rawOffset: number
  rawSize: number
  characteristics: number
}

interface PeLayout {
  peOffset: number
  machine: number
  is64: boolean
  optionalHeader: number
  dataDirectories: number
  sections: Section[]
  headerSize: number
  imageSize: number
}

const virtualEnd = (section: Section) => section.virtualAddress + Math.max(section.rawSize, section.virtualSize)

const rangesOverlap = (startA: number, endA: number, startB: number, endB: number) => startA < endB && startB < endA

const parseLayout = (reader: PeReader): PeLayout => {
  requireValid(reader.u16(0) === IMAGE_DOS_SIGNATURE, 'invalid DOS signature')
  const peOffset = reader.u32(DOS_HEADER_LFANEW_OFFSET)
  requireValid(
    peOffset >= DOS_HEADER_SIZE && peOffset <= MAX_PE_HEADER_OFFSET && reader.u32(peOffset) === IMAGE_NT_SIGNATURE,
    'invalid PE header'
  )

  const machine = reader.u16(peOffset + IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET)
  requireValid(
    machine === IMAGE_FILE_MACHINE_AMD64 || machine === IMAGE_FILE_MACHINE_I386,
    `unsupported machine 0x${machine.toString(16)} (only x64 and x86 are supported)`
  )
  const is64 = machine === IMAGE_FILE_MACHINE_AMD64

  const optionalHeader = peOffset + IMAGE_OPTIONAL_HEADER_OFFSET
  requireValid(
    reader.u16(peOffset + IMAGE_FILE_HEADER_SIZEOFOPTIONALHEADER_OFFSET) ===
      (is64 ? IMAGE_SIZEOF_OPTIONAL_HEADER64 : IMAGE_SIZEOF_OPTIONAL_HEADER32) &&
      reader.u16(optionalHeader) === (is64 ? IMAGE_NT_OPTIONAL_HDR64_MAGIC : IMAGE_NT_OPTIONAL_HDR32_MAGIC),
    'unsupported optional header'
  )
  const dataDirectories = peOffset + (is64 ? IMAGE_DATA_DIRECTORY64_OFFSET : IMAGE_DATA_DIRECTORY32_OFFSET)
  // NumberOfRvaAndSizes is the optional header field right before the data directories.
  requireValid(reader.u32(dataDirectories - 4) === IMAGE_NUMBEROF_DIRECTORY_ENTRIES, 'expected 16 data directories')

  const sectionTable = peOffset + (is64 ? IMAGE_NT_HEADERS64_SIZE : IMAGE_NT_HEADERS32_SIZE)
  const sectionCount = reader.u16(peOffset + IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET)
  const headerSize = reader.u32(optionalHeader + IMAGE_OPTIONAL_HEADER_SIZEOFHEADERS_OFFSET)
  const imageSize = reader.u32(optionalHeader + IMAGE_OPTIONAL_HEADER_SIZEOFIMAGE_OFFSET)
  requireValid(sectionCount > 0 && sectionCount <= MAX_SECTIONS, 'invalid section count')
  requireValid(
    headerSize >= sectionTable + sectionCount * IMAGE_SECTION_HEADER_SIZE && headerSize <= reader.data.length,
    'invalid header size'
  )

  const sections = Array.from({length: sectionCount}, (_, i): Section => {
    const headerOffset = sectionTable + i * IMAGE_SECTION_HEADER_SIZE
    const section = {
      headerOffset,
      virtualAddress: reader.u32(headerOffset + IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET),
      virtualSize: reader.u32(headerOffset + IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET),
      rawOffset: reader.u32(headerOffset + IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET),
      rawSize: reader.u32(headerOffset + IMAGE_SECTION_HEADER_SIZEOFRAWDATA_OFFSET),
      characteristics: reader.u32(headerOffset + IMAGE_SECTION_HEADER_CHARACTERISTICS_OFFSET),
    }
    reader.checkRange(section.rawOffset, section.rawSize)
    requireValid(section.rawSize === 0 || section.rawOffset >= headerSize, 'section overlaps headers')
    requireValid(
      section.virtualAddress >= headerSize && virtualEnd(section) <= imageSize,
      'invalid section address range'
    )

    return section
  })

  // The reduced PE keeps the original layout, so overlapping sections could leak or corrupt bytes.
  sections.forEach((current, i) => {
    for (const other of sections.slice(i + 1)) {
      requireValid(
        !current.rawSize ||
          !other.rawSize ||
          !rangesOverlap(
            current.rawOffset,
            current.rawOffset + current.rawSize,
            other.rawOffset,
            other.rawOffset + other.rawSize
          ),
        'overlapping raw sections'
      )
      requireValid(
        !rangesOverlap(current.virtualAddress, virtualEnd(current), other.virtualAddress, virtualEnd(other)),
        'overlapping virtual sections'
      )
    }
  })

  return {peOffset, machine, is64, optionalHeader, dataDirectories, sections, headerSize, imageSize}
}

/** Converts an RVA range to a file offset. Records inside code sections are rejected: copying them would copy code. */
const fileOffsetOf = (layout: PeLayout, rva: number, size: number): number => {
  const section = layout.sections.find((s) => rva >= s.virtualAddress && rva + size <= s.virtualAddress + s.rawSize)
  requireValid(section !== undefined, 'unmapped record RVA')
  requireValid(
    (section.characteristics & (IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE)) === 0,
    'metadata in a code/executable section is unsupported'
  )

  return section.rawOffset + rva - section.virtualAddress
}

const readDataDirectory = (reader: PeReader, layout: PeLayout, index: number) => {
  const entry = layout.dataDirectories + index * IMAGE_DATA_DIRECTORY_SIZE

  return {
    rva: reader.u32(entry + IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET),
    size: reader.u32(entry + IMAGE_DATA_DIRECTORY_SIZE_OFFSET),
  }
}

const writeDataDirectory = (output: Buffer, layout: PeLayout, index: number, rva: number, size: number) => {
  const entry = layout.dataDirectories + index * IMAGE_DATA_DIRECTORY_SIZE
  output.writeUInt32LE(rva, entry + IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET)
  output.writeUInt32LE(size, entry + IMAGE_DATA_DIRECTORY_SIZE_OFFSET)
}

/** ARM64EC images use the x64 machine type but describe their ARM64 code through CHPE metadata. */
const rejectHybridImage = (reader: PeReader, layout: PeLayout) => {
  const loadConfig = readDataDirectory(reader, layout, IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG)
  const chpeOffset = layout.is64 ? IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET : IMAGE_LOAD_CONFIG32_CHPE_METADATA_OFFSET
  const chpeEnd = chpeOffset + (layout.is64 ? 8 : 4)
  if (!loadConfig.rva || loadConfig.size < chpeEnd) {
    return
  }
  const offset = fileOffsetOf(layout, loadConfig.rva, loadConfig.size)
  // The first field of the load config structure is its own size; older images stop before the CHPE pointer.
  if (reader.u32(offset) < chpeEnd) {
    return
  }
  requireValid(
    reader.u32(offset + chpeOffset) === 0 && (!layout.is64 || reader.u32(offset + chpeOffset + 4) === 0),
    'hybrid CHPE/ARM64EC metadata is unsupported'
  )
}

/** Zero-filled buffer the size of the input; only explicitly claimed or copied ranges get content. */
class ReducedPeWriter {
  public readonly output: Buffer
  private readonly claimed = new Map<number, number>()

  constructor(
    private readonly reader: PeReader,
    size: number
  ) {
    this.output = Buffer.alloc(size)
  }

  /** Reserves a range whose content is written by the caller. */
  public claim(offset: number, size: number): void {
    this.reader.checkRange(offset, size)
    requireValid(!this.claimed.has(offset), 'overlapping metadata records')
    this.claimed.set(offset, size)
  }

  public copy(offset: number, size: number): void {
    this.claim(offset, size)
    this.reader.data.copy(this.output, offset, offset, offset + size)
  }

  public verifyNoOverlaps(): void {
    const ranges = [...this.claimed].sort(([a], [b]) => a - b)
    for (let i = 1; i < ranges.length; i++) {
      const [previousOffset, previousSize] = ranges[i - 1]
      requireValid(previousOffset + previousSize <= ranges[i][0], 'overlapping metadata records')
    }
  }
}

/**
 * Rebuilds only the header fields needed to parse the image and identify the module. The DOS stub,
 * Rich header, entry point, certificates and unused data directories are left zeroed.
 */
const writeHeaders = (writer: ReducedPeWriter, reader: PeReader, layout: PeLayout) => {
  const {output} = writer
  const {peOffset, optionalHeader} = layout

  output.writeUInt16LE(IMAGE_DOS_SIGNATURE, 0)
  output.writeUInt32LE(peOffset, DOS_HEADER_LFANEW_OFFSET)
  output.writeUInt32LE(IMAGE_NT_SIGNATURE, peOffset)
  output.writeUInt16LE(layout.machine, peOffset + IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET)
  output.writeUInt16LE(layout.sections.length, peOffset + IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET)
  // TimeDateStamp and SizeOfImage form the module's code identifier, used to match minidump modules.
  const timestamp = peOffset + IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET
  output.writeUInt32LE(reader.u32(timestamp), timestamp)
  output.writeUInt16LE(IMAGE_SIZEOF_OPTIONAL_HEADER64, peOffset + IMAGE_FILE_HEADER_SIZEOFOPTIONALHEADER_OFFSET)
  output.writeUInt16LE(
    IMAGE_FILE_EXECUTABLE_IMAGE | IMAGE_FILE_LARGE_ADDRESS_AWARE,
    peOffset + IMAGE_FILE_HEADER_CHARACTERISTICS_OFFSET
  )

  output.writeUInt16LE(IMAGE_NT_OPTIONAL_HDR64_MAGIC, optionalHeader)
  // ImageBase, SectionAlignment and FileAlignment are contiguous.
  reader.data.copy(
    output,
    optionalHeader + IMAGE_OPTIONAL_HEADER64_IMAGEBASE_OFFSET,
    optionalHeader + IMAGE_OPTIONAL_HEADER64_IMAGEBASE_OFFSET,
    optionalHeader + IMAGE_OPTIONAL_HEADER_FILEALIGNMENT_OFFSET + 4
  )
  output.writeUInt32LE(layout.imageSize, optionalHeader + IMAGE_OPTIONAL_HEADER_SIZEOFIMAGE_OFFSET)
  output.writeUInt32LE(layout.headerSize, optionalHeader + IMAGE_OPTIONAL_HEADER_SIZEOFHEADERS_OFFSET)
  output.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_CUI, optionalHeader + IMAGE_OPTIONAL_HEADER_SUBSYSTEM_OFFSET)
  output.writeUInt32LE(IMAGE_NUMBEROF_DIRECTORY_ENTRIES, layout.dataDirectories - 4)

  for (const [i, section] of layout.sections.entries()) {
    // Original names are dropped; parsers only need addresses and sizes.
    output.write(`.s${i}`, section.headerOffset, IMAGE_SHORT_NAME_SIZE, 'ascii')
    output.writeUInt32LE(section.virtualSize, section.headerOffset + IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET)
    output.writeUInt32LE(section.virtualAddress, section.headerOffset + IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET)
    output.writeUInt32LE(section.rawSize, section.headerOffset + IMAGE_SECTION_HEADER_SIZEOFRAWDATA_OFFSET)
    output.writeUInt32LE(section.rawOffset, section.headerOffset + IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET)
    output.writeUInt32LE(
      IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
      section.headerOffset + IMAGE_SECTION_HEADER_CHARACTERISTICS_OFFSET
    )
  }
}

/** Keeps the PDB GUID and age, which identify the module, and replaces the PDB path with a placeholder. */
const copyCodeViewIdentity = (writer: ReducedPeWriter, reader: PeReader, layout: PeLayout) => {
  const debug = readDataDirectory(reader, layout, IMAGE_DIRECTORY_ENTRY_DEBUG)
  requireValid(
    debug.rva > 0 &&
      debug.size > 0 &&
      debug.size % IMAGE_DEBUG_DIRECTORY_SIZE === 0 &&
      debug.size <= IMAGE_DEBUG_DIRECTORY_SIZE * MAX_DEBUG_ENTRIES,
    'invalid debug directory'
  )
  const debugOffset = fileOffsetOf(layout, debug.rva, debug.size)
  const codeViewEntries = Array.from(
    {length: debug.size / IMAGE_DEBUG_DIRECTORY_SIZE},
    (_, i) => debugOffset + i * IMAGE_DEBUG_DIRECTORY_SIZE
  ).filter((candidate) => reader.u32(candidate + IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET) === IMAGE_DEBUG_TYPE_CODEVIEW)
  requireValid(codeViewEntries.length === 1, 'expected one CodeView identity')

  const [entry] = codeViewEntries
  const codeViewSize = reader.u32(entry + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET)
  const codeViewRva = reader.u32(entry + IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET)
  const codeView = fileOffsetOf(layout, codeViewRva, codeViewSize)
  requireValid(
    codeViewSize >= REDUCED_CODEVIEW_SIZE &&
      codeView === reader.u32(entry + IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET) &&
      reader.u32(codeView) === PDB70_SIGNATURE,
    'invalid RSDS identity'
  )

  const {output} = writer
  writer.claim(entry, IMAGE_DEBUG_DIRECTORY_SIZE)
  output.writeUInt32LE(IMAGE_DEBUG_TYPE_CODEVIEW, entry + IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET)
  output.writeUInt32LE(REDUCED_CODEVIEW_SIZE, entry + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET)
  output.writeUInt32LE(codeViewRva, entry + IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET)
  output.writeUInt32LE(codeView, entry + IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET)
  writer.copy(codeView, REDUCED_CODEVIEW_SIZE)
  output.write(REDUCED_PDB_NAME, codeView + CV_INFO_PDB_FILENAME_OFFSET, 'ascii')
  writeDataDirectory(
    output,
    layout,
    IMAGE_DIRECTORY_ENTRY_DEBUG,
    debug.rva + entry - debugOffset,
    IMAGE_DEBUG_DIRECTORY_SIZE
  )
}

/** Number of 2-byte slots an x64 unwind code occupies, including its own. */
const unwindCodeSlots = (op: number, info: number, version: number): number => {
  switch (op) {
    case UWOP_ALLOC_LARGE:
      return info === 0 ? 2 : 3
    case UWOP_SAVE_NONVOL:
    case UWOP_SAVE_XMM128:
      return 2
    case UWOP_SAVE_NONVOL_FAR:
    case UWOP_SPARE_CODE:
    case UWOP_SAVE_XMM128_FAR:
      return 3
    case UWOP_EPILOG:
      return version === 1 ? 2 : 1
    default:
      return 1
  }
}

/** Walks the unwind codes by opcode width, so a corrupt code count cannot pull unrelated bytes into the copy. */
const validateUnwindCodes = (reader: PeReader, unwindInfo: number, codeCount: number, version: number) => {
  for (let slot = 0; slot < codeCount; ) {
    const opAndInfo = reader.u8(unwindInfo + UNWIND_INFO_HEADER_SIZE + slot * UNWIND_CODE_SIZE + UNWIND_CODE_OP_OFFSET)
    const op = opAndInfo & 0xf
    const info = opAndInfo >>> 4
    requireValid(op <= UWOP_PUSH_MACHFRAME, 'unsupported unwind opcode')
    requireValid(op !== UWOP_ALLOC_LARGE || info <= 1, 'invalid ALLOC_LARGE')
    requireValid(op !== UWOP_PUSH_MACHFRAME || info <= 1, 'invalid PUSH_MACHFRAME')
    slot += unwindCodeSlots(op, info, version)
    requireValid(slot <= codeCount, 'truncated unwind opcode')
  }
}

/** Copies the exception table and every unwind record it reaches. Returns the number of functions. */
const copyExceptionTable = (writer: ReducedPeWriter, reader: PeReader, layout: PeLayout): number => {
  const table = readDataDirectory(reader, layout, IMAGE_DIRECTORY_ENTRY_EXCEPTION)
  requireValid(
    table.rva > 0 && table.size > 0 && table.size % RUNTIME_FUNCTION_SIZE === 0,
    'missing or invalid exception table'
  )
  const tableStart = fileOffsetOf(layout, table.rva, table.size)
  const tableEnd = tableStart + table.size
  writer.copy(tableStart, table.size)
  writeDataDirectory(writer.output, layout, IMAGE_DIRECTORY_ENTRY_EXCEPTION, table.rva, table.size)

  const visited = new Set<number>()
  const inProgress = new Set<number>()

  const copyUnwindData = (rva: number, depth: number): void => {
    requireValid(depth <= MAX_UNWIND_CHAIN_DEPTH && !inProgress.has(rva), 'cyclic or excessively deep unwind chain')
    if (visited.has(rva)) {
      return
    }
    inProgress.add(rva)
    if (rva & RUNTIME_FUNCTION_INDIRECT) {
      copyIndirectRuntimeFunction(rva - RUNTIME_FUNCTION_INDIRECT, depth)
    } else {
      copyUnwindInfo(rva, depth)
    }
    inProgress.delete(rva)
    visited.add(rva)
  }

  const copyIndirectRuntimeFunction = (rva: number, depth: number) => {
    const target = fileOffsetOf(layout, rva, RUNTIME_FUNCTION_SIZE)
    // Indirect entries usually point at another function of the exception table, which is already copied.
    if (target >= tableStart && target < tableEnd) {
      requireValid((target - tableStart) % RUNTIME_FUNCTION_SIZE === 0, 'unaligned indirect runtime function')
    } else {
      writer.copy(target, RUNTIME_FUNCTION_SIZE)
    }
    copyUnwindData(reader.u32(target + RUNTIME_FUNCTION_UNWIND_OFFSET), depth + 1)
  }

  const copyUnwindInfo = (rva: number, depth: number) => {
    requireValid(rva > 0 && rva % 4 === 0, 'unaligned unwind record')
    const unwindInfo = fileOffsetOf(layout, rva, UNWIND_INFO_HEADER_SIZE)
    const versionAndFlags = reader.u8(unwindInfo + UNWIND_INFO_VERSION_FLAGS_OFFSET)
    const version = versionAndFlags & 0x7
    const flags = versionAndFlags >>> 3
    const codeCount = reader.u8(unwindInfo + UNWIND_INFO_COUNT_OF_CODES_OFFSET)
    requireValid((version === 1 || version === 2) && flags <= UNW_FLAG_CHAININFO, 'unsupported unwind version or flags')

    const codesSize = UNWIND_INFO_HEADER_SIZE + UNWIND_CODE_SIZE * codeCount
    const trailer = (codesSize + 3) & ~3
    const hasHandler = (flags & (UNW_FLAG_EHANDLER | UNW_FLAG_UHANDLER)) !== 0
    const trailerSize = flags === UNW_FLAG_CHAININFO ? RUNTIME_FUNCTION_SIZE : hasHandler ? 4 : 0
    fileOffsetOf(layout, rva, trailer + trailerSize)
    validateUnwindCodes(reader, unwindInfo, codeCount, version)

    writer.copy(unwindInfo, codesSize)
    // Exception handlers and their language-specific data are not needed to unwind: drop them and their flags.
    writer.output[unwindInfo + UNWIND_INFO_VERSION_FLAGS_OFFSET] =
      version | (flags === UNW_FLAG_CHAININFO ? UNW_FLAG_CHAININFO << 3 : 0)
    if (flags === UNW_FLAG_CHAININFO) {
      writer.copy(unwindInfo + trailer, RUNTIME_FUNCTION_SIZE)
      copyUnwindData(reader.u32(unwindInfo + trailer + RUNTIME_FUNCTION_UNWIND_OFFSET), depth + 1)
    }
  }

  let functions = 0
  for (let entry = tableStart; entry < tableEnd; entry += RUNTIME_FUNCTION_SIZE) {
    const begin = reader.u32(entry + RUNTIME_FUNCTION_BEGIN_OFFSET)
    const end = reader.u32(entry + RUNTIME_FUNCTION_END_OFFSET)
    const unwind = reader.u32(entry + RUNTIME_FUNCTION_UNWIND_OFFSET)
    if (begin === 0 && end === 0 && unwind === 0) {
      continue
    }
    requireValid(begin > 0 && begin < layout.imageSize, 'invalid function address')
    requireValid(end > begin && end <= layout.imageSize, 'invalid function range')
    copyUnwindData(unwind, 0)
    functions++
  }
  requireValid(functions > 0, 'empty exception table')

  return functions
}

export const extractPeUnwindInfo = (input: Buffer): ReducedPE => {
  const reader = new PeReader(input)
  const layout = parseLayout(reader)
  rejectHybridImage(reader, layout)
  if (!layout.is64) {
    return {architecture: 'x86', functions: 0}
  }

  const outputSize = Math.max(
    layout.headerSize,
    ...layout.sections.map((s) => (s.rawSize ? s.rawOffset + s.rawSize : 0))
  )
  const writer = new ReducedPeWriter(reader, outputSize)
  writeHeaders(writer, reader, layout)
  copyCodeViewIdentity(writer, reader, layout)
  const functions = copyExceptionTable(writer, reader, layout)
  writer.verifyNoOverlaps()

  return {architecture: 'x64', data: writer.output, functions}
}

export const copyPeUnwindInfo = async (filename: string, outputFile: string): Promise<ReducedPE> => {
  const result = extractPeUnwindInfo(await fs.promises.readFile(filename))
  if (result.data) {
    await fs.promises.writeFile(outputFile, result.data, {flag: 'wx', mode: 0o600})
  }

  return result
}
