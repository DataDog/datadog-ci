/* eslint-disable no-bitwise -- unwind codes pack the opcode and its info into one byte. */
import {
  CV_INFO_AGE_OFFSET,
  CV_INFO_GUID_OFFSET,
  CV_INFO_PDB_FILENAME_OFFSET,
  DOS_HEADER_LFANEW_OFFSET,
  DOS_HEADER_SIZE,
  IMAGE_DATA_DIRECTORY32_OFFSET,
  IMAGE_DATA_DIRECTORY64_OFFSET,
  IMAGE_DATA_DIRECTORY_SIZE,
  IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_SIZE,
  IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET,
  IMAGE_DEBUG_TYPE_CODEVIEW,
  IMAGE_DIRECTORY_ENTRY_DEBUG,
  IMAGE_DIRECTORY_ENTRY_EXCEPTION,
  IMAGE_DOS_SIGNATURE,
  IMAGE_FILE_HEADER_SIZEOFOPTIONALHEADER_OFFSET,
  IMAGE_NT_HEADERS32_SIZE,
  IMAGE_NT_HEADERS64_SIZE,
  IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET,
  IMAGE_NT_OPTIONAL_HDR32_MAGIC,
  IMAGE_NT_OPTIONAL_HDR64_MAGIC,
  IMAGE_NT_SIGNATURE,
  IMAGE_NUMBEROF_DIRECTORY_ENTRIES,
  IMAGE_OPTIONAL_HEADER32_IMAGEBASE_OFFSET,
  IMAGE_OPTIONAL_HEADER64_IMAGEBASE_OFFSET,
  IMAGE_OPTIONAL_HEADER_FILEALIGNMENT_OFFSET,
  IMAGE_OPTIONAL_HEADER_OFFSET,
  IMAGE_OPTIONAL_HEADER_SECTIONALIGNMENT_OFFSET,
  IMAGE_OPTIONAL_HEADER_SIZEOFHEADERS_OFFSET,
  IMAGE_OPTIONAL_HEADER_SIZEOFIMAGE_OFFSET,
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
  IMAGE_SIZEOF_OPTIONAL_HEADER32,
  IMAGE_SIZEOF_OPTIONAL_HEADER64,
  PDB70_SIGNATURE,
  RUNTIME_FUNCTION_BEGIN_OFFSET,
  RUNTIME_FUNCTION_END_OFFSET,
  RUNTIME_FUNCTION_INDIRECT,
  RUNTIME_FUNCTION_SIZE,
  RUNTIME_FUNCTION_UNWIND_OFFSET,
  UNWIND_CODE_SIZE,
  UNWIND_INFO_COUNT_OF_CODES_OFFSET,
  UNWIND_INFO_HEADER_SIZE,
  UNWIND_INFO_SIZE_OF_PROLOG_OFFSET,
  UNWIND_INFO_VERSION_FLAGS_OFFSET,
  UWOP_ALLOC_SMALL,
} from '../pe-constants'

/*
 * Small synthetic PE used to test unwind extraction. Every section is 0x200 bytes:
 *
 *   file offset  RVA     section  content
 *   0x000        -       headers  DOS header (stub contains "DOS_SECRET"), PE headers, section table
 *   0x200        0x1000  .text    code, filled with 0xCC
 *   0x400        0x2000  .rdata   debug directory, CodeView record, "PRIVATE_DATA", unwind info
 *   0x600        0x3000  .pdata   exception table: one function covering 0x1000-0x1020
 *
 * DOS_SECRET, PRIVATE_DATA and PRIVATE_PATH (in the PDB path) must never survive extraction.
 */

export const MACHINE = {
  x64: 0x8664,
  x86: 0x14c,
  arm32: 0x1c0,
  thumb2: 0x1c4,
  arm64: 0xaa64,
  arm64ec: 0xa641,
  arm64x: 0xa64e,
}

export const SECTION_SIZE = 0x200

const CODE_SECTION = IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_MEM_READ
const DATA_SECTION = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ

export const SECTIONS = [
  {name: '.text', rva: 0x1000, fileOffset: 0x200, characteristics: CODE_SECTION},
  {name: '.rdata', rva: 0x2000, fileOffset: 0x400, characteristics: DATA_SECTION},
  {name: '.pdata', rva: 0x3000, fileOffset: 0x600, characteristics: DATA_SECTION},
]

export const RVA = {
  code: 0x1000,
  debugDirectory: 0x2000,
  codeView: 0x2040,
  privateData: 0x2080,
  unwindInfo: 0x2100,
  /** Free space in .rdata after the unwind info, for tests that add records. */
  spare: 0x2120,
  exceptionTable: 0x3000,
}

export const FUNCTION = {begin: 0x1000, end: 0x1020}
export const TIMESTAMP = 123456
export const PDB_PATH = 'C:\\PRIVATE_PATH\\original.pdb'
export const SECRETS = ['DOS_SECRET', 'PRIVATE_DATA', 'PRIVATE_PATH', 'original.pdb']

const PE_OFFSET = 0x80
const OPTIONAL_HEADER = PE_OFFSET + IMAGE_OPTIONAL_HEADER_OFFSET

export const fileOffset = (rva: number): number => {
  const section = SECTIONS.find((s) => rva >= s.rva && rva < s.rva + SECTION_SIZE)
  if (!section) {
    throw new Error(`RVA 0x${rva.toString(16)} is outside the fixture sections`)
  }

  return section.fileOffset + rva - section.rva
}

export const bytesAt = (pe: Buffer, rva: number, size: number): Buffer =>
  pe.subarray(fileOffset(rva), fileOffset(rva) + size)

const is64 = (pe: Buffer) => pe.readUInt16LE(OPTIONAL_HEADER) === IMAGE_NT_OPTIONAL_HDR64_MAGIC

export const setDataDirectory = (pe: Buffer, index: number, rva: number, size: number) => {
  const directories = PE_OFFSET + (is64(pe) ? IMAGE_DATA_DIRECTORY64_OFFSET : IMAGE_DATA_DIRECTORY32_OFFSET)
  pe.writeUInt32LE(rva, directories + index * IMAGE_DATA_DIRECTORY_SIZE)
  pe.writeUInt32LE(size, directories + index * IMAGE_DATA_DIRECTORY_SIZE + 4)
}

export const sectionHeaderOffset = (pe: Buffer, index: number) =>
  PE_OFFSET + (is64(pe) ? IMAGE_NT_HEADERS64_SIZE : IMAGE_NT_HEADERS32_SIZE) + index * IMAGE_SECTION_HEADER_SIZE

export interface RuntimeFunction {
  begin: number
  end: number
  unwind: number
}

export const writeRuntimeFunction = (pe: Buffer, rva: number, {begin, end, unwind}: RuntimeFunction) => {
  const offset = fileOffset(rva)
  pe.writeUInt32LE(begin, offset + RUNTIME_FUNCTION_BEGIN_OFFSET)
  pe.writeUInt32LE(end, offset + RUNTIME_FUNCTION_END_OFFSET)
  pe.writeUInt32LE(unwind, offset + RUNTIME_FUNCTION_UNWIND_OFFSET)
}

/** Unwind pointer to another RUNTIME_FUNCTION instead of an UNWIND_INFO record. */
export const indirect = (runtimeFunctionRva: number) => runtimeFunctionRva | RUNTIME_FUNCTION_INDIRECT

/** Writes entry `index` of the exception table. */
export const setRuntimeFunction = (pe: Buffer, index: number, runtimeFunction: RuntimeFunction) =>
  writeRuntimeFunction(pe, RVA.exceptionTable + index * RUNTIME_FUNCTION_SIZE, runtimeFunction)

/** One UNWIND_CODE slot: the prolog offset it applies at, the operation and its info nibble. */
export const unwindCode = (codeOffset: number, op: number, info = 0): [number, number] => [codeOffset, op | (info << 4)]

/** `sub rsp, 0x20` at prolog offset 4: the fixture function's only unwind code. */
export const ALLOCATE_32_BYTES = unwindCode(4, UWOP_ALLOC_SMALL, 3)

export interface UnwindInfo {
  version?: number
  flags?: number
  prologSize?: number
  codes?: [number, number][]
}

/** Writes an UNWIND_INFO record and returns the RVA of its trailer (handler RVA or chained function). */
export const writeUnwindInfo = (
  pe: Buffer,
  rva: number,
  {version = 1, flags = 0, prologSize = 4, codes = [ALLOCATE_32_BYTES]}: UnwindInfo = {}
): number => {
  const offset = fileOffset(rva)
  pe.writeUInt8(version | (flags << 3), offset + UNWIND_INFO_VERSION_FLAGS_OFFSET)
  pe.writeUInt8(prologSize, offset + UNWIND_INFO_SIZE_OF_PROLOG_OFFSET)
  pe.writeUInt8(codes.length, offset + UNWIND_INFO_COUNT_OF_CODES_OFFSET)
  codes.forEach((code, i) => pe.set(code, offset + UNWIND_INFO_HEADER_SIZE + i * UNWIND_CODE_SIZE))

  return rva + ((UNWIND_INFO_HEADER_SIZE + codes.length * UNWIND_CODE_SIZE + 3) & ~3)
}

export const makePE = (machine = MACHINE.x64): Buffer => {
  const pe = Buffer.alloc(0x800)
  const wide = machine !== MACHINE.x86

  pe.writeUInt16LE(IMAGE_DOS_SIGNATURE, 0)
  pe.writeUInt32LE(PE_OFFSET, DOS_HEADER_LFANEW_OFFSET)
  pe.write('DOS_SECRET', DOS_HEADER_SIZE)

  pe.writeUInt32LE(IMAGE_NT_SIGNATURE, PE_OFFSET)
  pe.writeUInt16LE(machine, PE_OFFSET + IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET)
  pe.writeUInt16LE(SECTIONS.length, PE_OFFSET + IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET)
  pe.writeUInt32LE(TIMESTAMP, PE_OFFSET + IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET)
  pe.writeUInt16LE(
    wide ? IMAGE_SIZEOF_OPTIONAL_HEADER64 : IMAGE_SIZEOF_OPTIONAL_HEADER32,
    PE_OFFSET + IMAGE_FILE_HEADER_SIZEOFOPTIONALHEADER_OFFSET
  )

  pe.writeUInt16LE(wide ? IMAGE_NT_OPTIONAL_HDR64_MAGIC : IMAGE_NT_OPTIONAL_HDR32_MAGIC, OPTIONAL_HEADER)
  if (wide) {
    pe.writeBigUInt64LE(BigInt('0x140000000'), OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER64_IMAGEBASE_OFFSET)
  } else {
    pe.writeUInt32LE(0x400000, OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER32_IMAGEBASE_OFFSET)
  }
  pe.writeUInt32LE(0x1000, OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER_SECTIONALIGNMENT_OFFSET)
  pe.writeUInt32LE(0x200, OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER_FILEALIGNMENT_OFFSET)
  pe.writeUInt32LE(0x4000, OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER_SIZEOFIMAGE_OFFSET)
  pe.writeUInt32LE(SECTIONS[0].fileOffset, OPTIONAL_HEADER + IMAGE_OPTIONAL_HEADER_SIZEOFHEADERS_OFFSET)
  const directories = PE_OFFSET + (wide ? IMAGE_DATA_DIRECTORY64_OFFSET : IMAGE_DATA_DIRECTORY32_OFFSET)
  pe.writeUInt32LE(IMAGE_NUMBEROF_DIRECTORY_ENTRIES, directories - 4)

  SECTIONS.forEach((section, i) => {
    const header = sectionHeaderOffset(pe, i)
    pe.write(section.name, header)
    pe.writeUInt32LE(SECTION_SIZE, header + IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET)
    pe.writeUInt32LE(section.rva, header + IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET)
    pe.writeUInt32LE(SECTION_SIZE, header + IMAGE_SECTION_HEADER_SIZEOFRAWDATA_OFFSET)
    pe.writeUInt32LE(section.fileOffset, header + IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET)
    pe.writeUInt32LE(section.characteristics, header + IMAGE_SECTION_HEADER_CHARACTERISTICS_OFFSET)
  })

  pe.fill(0xcc, fileOffset(RVA.code), fileOffset(RVA.code) + SECTION_SIZE)
  pe.write('PRIVATE_DATA', fileOffset(RVA.privateData))

  // One CodeView debug entry pointing at an RSDS record: GUID 0xABAB..., age 1, then the PDB path.
  setDataDirectory(pe, IMAGE_DIRECTORY_ENTRY_DEBUG, RVA.debugDirectory, IMAGE_DEBUG_DIRECTORY_SIZE)
  const debugEntry = fileOffset(RVA.debugDirectory)
  const codeView = fileOffset(RVA.codeView)
  pe.writeUInt32LE(IMAGE_DEBUG_TYPE_CODEVIEW, debugEntry + IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET)
  pe.writeUInt32LE(
    CV_INFO_PDB_FILENAME_OFFSET + PDB_PATH.length + 1,
    debugEntry + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET
  )
  pe.writeUInt32LE(RVA.codeView, debugEntry + IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET)
  pe.writeUInt32LE(codeView, debugEntry + IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET)
  pe.writeUInt32LE(PDB70_SIGNATURE, codeView)
  pe.fill(0xab, codeView + CV_INFO_GUID_OFFSET, codeView + CV_INFO_AGE_OFFSET)
  pe.writeUInt32LE(1, codeView + CV_INFO_AGE_OFFSET)
  pe.write(`${PDB_PATH}\0`, codeView + CV_INFO_PDB_FILENAME_OFFSET)

  setDataDirectory(pe, IMAGE_DIRECTORY_ENTRY_EXCEPTION, RVA.exceptionTable, RUNTIME_FUNCTION_SIZE)
  setRuntimeFunction(pe, 0, {...FUNCTION, unwind: RVA.unwindInfo})
  const trailer = writeUnwindInfo(pe, RVA.unwindInfo)
  // Alignment padding after the last unwind code: must not be copied.
  pe.writeUInt16BE(0xdead, fileOffset(trailer) - UNWIND_CODE_SIZE)

  return pe
}
