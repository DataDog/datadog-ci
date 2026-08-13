import fs from 'fs'

import {
  WASM_BUILD_ID_SECTION_NAME,
  WASM_DEBUG_SECTION_PREFIX,
  WASM_EXTERNAL_DEBUG_INFO_SECTION_NAME,
  WASM_MAGIC,
  WASM_VERSION,
  WasmSectionId,
} from './wasm-constants'

export type WasmFileMetadata = {
  filename: string
  isWasm: boolean
  buildId: string
  hasDebugInfo: boolean
  hasExternalDebugInfo: boolean
  error?: Error
}

export type WasmSection = {
  id: WasmSectionId
  // Only populated for custom sections (id === WasmSectionId.CUSTOM).
  name: string
  payload: Buffer
}

// Reads an unsigned LEB128-encoded integer starting at `offset`.
// https://webassembly.github.io/spec/core/binary/values.html#binary-int
export const readUnsignedLEB128 = (buffer: Buffer, offset: number): {value: number; nextOffset: number} => {
  let result = BigInt(0)
  let shift = BigInt(0)
  let pos = offset
  let byte: number

  do {
    if (pos >= buffer.length) {
      throw new Error('Unexpected end of buffer while reading a LEB128 value')
    }
    byte = buffer.readUInt8(pos)
    pos += 1
    // eslint-disable-next-line no-bitwise
    result |= BigInt(byte & 0x7f) << shift
    shift += BigInt(7)
    // eslint-disable-next-line no-bitwise
  } while ((byte & 0x80) !== 0)

  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('LEB128 value is too large to be represented as a safe integer')
  }

  return {value: Number(result), nextOffset: pos}
}

export const isWasmFile = (buffer: Buffer): boolean =>
  buffer.length >= 8 && buffer.subarray(0, 4).equals(WASM_MAGIC) && buffer.subarray(4, 8).equals(WASM_VERSION)

// Walks the section table of a WASM module. Assumes `isWasmFile(buffer)` is true.
export const readWasmSections = (buffer: Buffer): WasmSection[] => {
  const sections: WasmSection[] = []
  let offset = WASM_MAGIC.length + WASM_VERSION.length

  while (offset < buffer.length) {
    const id = buffer.readUInt8(offset) as WasmSectionId
    offset += 1

    const {value: size, nextOffset} = readUnsignedLEB128(buffer, offset)
    const sectionEnd = nextOffset + size
    if (sectionEnd > buffer.length) {
      throw new Error(`Invalid WASM file: section of type ${id} extends beyond the end of the file`)
    }

    let name = ''
    let payload = buffer.subarray(nextOffset, sectionEnd)
    if (id === WasmSectionId.CUSTOM) {
      const {value: nameLength, nextOffset: afterNameLength} = readUnsignedLEB128(buffer, nextOffset)
      const nameEnd = afterNameLength + nameLength
      if (nameEnd > sectionEnd) {
        throw new Error('Invalid WASM file: custom section name extends beyond its section')
      }
      name = buffer.toString('utf8', afterNameLength, nameEnd)
      payload = buffer.subarray(nameEnd, sectionEnd)
    }

    sections.push({id, name, payload})
    offset = sectionEnd
  }

  return sections
}

export const getWasmFileMetadata = async (filename: string): Promise<WasmFileMetadata> => {
  const metadata: WasmFileMetadata = {
    filename,
    isWasm: false,
    buildId: '',
    hasDebugInfo: false,
    hasExternalDebugInfo: false,
  }

  try {
    const buffer = await fs.promises.readFile(filename)
    if (!isWasmFile(buffer)) {
      return metadata
    }
    metadata.isWasm = true

    const sections = readWasmSections(buffer)

    const buildIdSection = sections.find(
      (section) => section.id === WasmSectionId.CUSTOM && section.name === WASM_BUILD_ID_SECTION_NAME
    )
    if (buildIdSection) {
      metadata.buildId = buildIdSection.payload.toString('hex')
    }

    metadata.hasExternalDebugInfo = sections.some(
      (section) => section.id === WasmSectionId.CUSTOM && section.name === WASM_EXTERNAL_DEBUG_INFO_SECTION_NAME
    )
    metadata.hasDebugInfo = sections.some(
      (section) => section.id === WasmSectionId.CUSTOM && section.name.startsWith(WASM_DEBUG_SECTION_PREFIX)
    )
  } catch (error) {
    metadata.error = error
  }

  return metadata
}

export const getOutputFilenameFromBuildId = (buildId: string): string => buildId.replace(/\//g, '-')
