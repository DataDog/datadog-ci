import {createHash} from 'crypto'
import fs from 'fs'

import {
  DEFAULT_WASM_ARCH,
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
  arch: string
  buildId: string
  fileHash: string
  hasDebugInfo: boolean
  hasExternalDebugInfo: boolean
  hasCode: boolean
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

// The Datadog Browser SDK reads this section from the module at `WebAssembly.instantiate` time.
// When absent (most toolchains don't emit it by default), datadog-ci and the SDK must derive the
// same fallback identifier so that uploaded symbols can still be looked up: the SHA-256 of the
// code section's raw bytes.
export const computeCodeSectionHash = (codeSectionPayload: Buffer): string =>
  createHash('sha256').update(codeSectionPayload).digest('hex')

// Same convention as the ELF/PE uploaders: SHA-256 of the first and last 4096 bytes of the file
// plus the file size, truncated to 128 bits. Cheap to compute on very large debug artifacts.
export const computeFileHash = async (filename: string): Promise<string> => {
  const fd = await fs.promises.open(filename, 'r')
  try {
    const stats = await fd.stat()
    const fileSize = stats.size
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(4096)
    let {bytesRead} = await fd.read(buffer, 0, 4096, 0)
    hash.update(buffer.subarray(0, bytesRead))
    ;({bytesRead} = await fd.read(buffer, 0, 4096, Math.max(0, fileSize - 4096)))
    hash.update(buffer.subarray(0, bytesRead))

    buffer.writeBigUInt64BE(BigInt(fileSize), 0)
    hash.update(buffer.subarray(0, 8))

    return hash.digest('hex').slice(0, 32)
  } finally {
    await fd.close()
  }
}

export const getWasmFileMetadata = async (filename: string): Promise<WasmFileMetadata> => {
  const metadata: WasmFileMetadata = {
    filename,
    isWasm: false,
    arch: DEFAULT_WASM_ARCH,
    buildId: '',
    fileHash: '',
    hasDebugInfo: false,
    hasExternalDebugInfo: false,
    hasCode: false,
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

    const codeSection = sections.find((section) => section.id === WasmSectionId.CODE)
    metadata.hasCode = codeSection !== undefined && codeSection.payload.length > 0

    if (!metadata.buildId && codeSection) {
      metadata.buildId = computeCodeSectionHash(codeSection.payload)
    }

    if (metadata.hasCode) {
      metadata.fileHash = await computeFileHash(filename)
    }
  } catch (error) {
    metadata.error = error
  }

  return metadata
}

export const getBuildIdWithArch = (fileMetadata: WasmFileMetadata): string =>
  `${fileMetadata.buildId}-${fileMetadata.arch}`

export const getOutputFilenameFromBuildId = (buildId: string): string => buildId.replace(/\//g, '-')
