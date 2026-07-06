import {createHash} from 'crypto'
import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {
  computeCodeSectionHash,
  computeFileHash,
  getBuildIdWithArch,
  getOutputFilenameFromBuildId,
  getWasmFileMetadata,
  isWasmFile,
  readUnsignedLEB128,
  readWasmSections,
} from '../wasm'
import {WasmSectionId} from '../wasm-constants'

import {buildCustomSection, buildSection, buildWasmModule, encodeUnsignedLEB128} from './wasm-test-helpers'

describe('isWasmFile', () => {
  test('returns true for a valid magic number and version', () => {
    expect(isWasmFile(buildWasmModule([]))).toBe(true)
  })

  test('returns false for a buffer that is too short', () => {
    expect(isWasmFile(Buffer.from([0x00, 0x61, 0x73]))).toBe(false)
  })

  test('returns false for a wrong magic number', () => {
    expect(isWasmFile(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x00, 0x00, 0x00]))).toBe(false)
  })
})

describe('readUnsignedLEB128', () => {
  test.each([0, 1, 127, 128, 255, 300, 16384, 2 ** 32, Number.MAX_SAFE_INTEGER])('round-trips %d', (value) => {
    const encoded = encodeUnsignedLEB128(value)
    const {value: decoded, nextOffset} = readUnsignedLEB128(encoded, 0)
    expect(decoded).toBe(value)
    expect(nextOffset).toBe(encoded.length)
  })

  test('throws on truncated input', () => {
    const encoded = encodeUnsignedLEB128(300)
    const truncated = encoded.subarray(0, encoded.length - 1)
    expect(() => readUnsignedLEB128(truncated, 0)).toThrow()
  })
})

describe('readWasmSections', () => {
  test('parses a custom section name and payload', () => {
    const buildIdPayload = Buffer.from('deadbeef', 'hex')
    const module = buildWasmModule([buildCustomSection('build_id', buildIdPayload)])

    const sections = readWasmSections(module)
    expect(sections).toHaveLength(1)
    expect(sections[0].id).toBe(WasmSectionId.CUSTOM)
    expect(sections[0].name).toBe('build_id')
    expect(sections[0].payload).toEqual(buildIdPayload)
  })

  test('parses multiple sections in order', () => {
    const codePayload = Buffer.from([0x01, 0x02, 0x03])
    const module = buildWasmModule([
      buildCustomSection('build_id', Buffer.from('ab', 'hex')),
      buildSection(WasmSectionId.CODE, codePayload),
    ])

    const sections = readWasmSections(module)
    expect(sections.map((s) => s.id)).toEqual([WasmSectionId.CUSTOM, WasmSectionId.CODE])
    expect(sections[1].payload).toEqual(codePayload)
  })

  test('throws when a section overruns the buffer', () => {
    const module = Buffer.concat([buildWasmModule([]), Buffer.from([WasmSectionId.CODE, 0x10])])
    expect(() => readWasmSections(module)).toThrow()
  })
})

describe('computeCodeSectionHash', () => {
  test('matches a plain sha256 of the payload', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04])
    expect(computeCodeSectionHash(payload)).toBe(createHash('sha256').update(payload).digest('hex'))
  })
})

describe('computeFileHash', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'wasm-tests-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true})
  })

  test('is deterministic for the same content', async () => {
    const filename = upath.join(tmpDir, 'a.wasm')
    fs.writeFileSync(filename, Buffer.from('some file content'))

    const hash1 = await computeFileHash(filename)
    const hash2 = await computeFileHash(filename)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(32)
  })

  test('differs for different content', async () => {
    const filenameA = upath.join(tmpDir, 'a.wasm')
    const filenameB = upath.join(tmpDir, 'b.wasm')
    fs.writeFileSync(filenameA, Buffer.from('content a'))
    fs.writeFileSync(filenameB, Buffer.from('content b'))

    expect(await computeFileHash(filenameA)).not.toBe(await computeFileHash(filenameB))
  })
})

describe('getWasmFileMetadata', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'wasm-tests-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true})
  })

  test('returns isWasm=false for a non-WASM file', async () => {
    const filename = upath.join(tmpDir, 'not-wasm.txt')
    fs.writeFileSync(filename, 'hello world')

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.isWasm).toBe(false)
  })

  test('extracts build_id from the build_id custom section', async () => {
    const filename = upath.join(tmpDir, 'with-build-id.wasm')
    const codePayload = Buffer.from([0xaa, 0xbb])
    const module = buildWasmModule([
      buildCustomSection('build_id', Buffer.from('deadbeef', 'hex')),
      buildCustomSection('.debug_info', Buffer.from([0x00])),
      buildSection(WasmSectionId.CODE, codePayload),
    ])
    fs.writeFileSync(filename, module)

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.isWasm).toBe(true)
    expect(metadata.buildId).toBe('deadbeef')
    expect(metadata.hasDebugInfo).toBe(true)
    expect(metadata.hasExternalDebugInfo).toBe(false)
    expect(metadata.hasCode).toBe(true)
    expect(metadata.fileHash).toHaveLength(32)
  })

  test('falls back to the code section hash when no build_id section is present', async () => {
    const filename = upath.join(tmpDir, 'no-build-id.wasm')
    const codePayload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05])
    const module = buildWasmModule([
      buildCustomSection('.debug_line', Buffer.from([0x00])),
      buildSection(WasmSectionId.CODE, codePayload),
    ])
    fs.writeFileSync(filename, module)

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.buildId).toBe(computeCodeSectionHash(codePayload))
  })

  test('detects external_debug_info section', async () => {
    const filename = upath.join(tmpDir, 'external-debug-info.wasm')
    const module = buildWasmModule([
      buildCustomSection('build_id', Buffer.from('cafe', 'hex')),
      buildCustomSection('external_debug_info', Buffer.from('some/path.debug.wasm', 'utf8')),
      buildSection(WasmSectionId.CODE, Buffer.from([0x01])),
    ])
    fs.writeFileSync(filename, module)

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.hasDebugInfo).toBe(false)
    expect(metadata.hasExternalDebugInfo).toBe(true)
  })

  test('has no build id and no code section when the module is empty', async () => {
    const filename = upath.join(tmpDir, 'empty.wasm')
    fs.writeFileSync(filename, buildWasmModule([]))

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.isWasm).toBe(true)
    expect(metadata.buildId).toBe('')
    expect(metadata.hasCode).toBe(false)
    expect(metadata.fileHash).toBe('')
  })

  test('records a parse error instead of throwing', async () => {
    const filename = upath.join(tmpDir, 'corrupt.wasm')
    const module = Buffer.concat([buildWasmModule([]), Buffer.from([WasmSectionId.CODE, 0xff, 0xff, 0xff, 0xff, 0x7f])])
    fs.writeFileSync(filename, module)

    const metadata = await getWasmFileMetadata(filename)
    expect(metadata.isWasm).toBe(true)
    expect(metadata.error).toBeInstanceOf(Error)
  })
})

describe('getBuildIdWithArch', () => {
  test('combines build id and arch', () => {
    expect(getBuildIdWithArch({buildId: 'abc', arch: 'wasm32'} as any)).toBe('abc-wasm32')
  })
})

describe('getOutputFilenameFromBuildId', () => {
  test('replaces slashes with dashes', () => {
    expect(getOutputFilenameFromBuildId('a/b/c')).toBe('a-b-c')
  })

  test('leaves build ids without slashes unchanged', () => {
    expect(getOutputFilenameFromBuildId('abcdef')).toBe('abcdef')
  })
})
