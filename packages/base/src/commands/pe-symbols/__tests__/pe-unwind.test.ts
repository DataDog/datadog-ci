import fs from 'fs'

import {
  CV_INFO_GUID_OFFSET,
  CV_INFO_PDB_FILENAME_OFFSET,
  IMAGE_DIRECTORY_ENTRY_EXCEPTION,
  IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG,
  IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET,
  IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET,
  RUNTIME_FUNCTION_SIZE,
  UNW_FLAG_CHAININFO,
  UNW_FLAG_EHANDLER,
  UNWIND_CODE_SIZE,
  UNWIND_INFO_HEADER_SIZE,
  UWOP_ALLOC_LARGE,
  UWOP_EPILOG,
} from '../pe-constants'
import {extractPeUnwindInfo} from '../pe-unwind'

import {
  bytesAt,
  FUNCTION,
  indirect,
  MACHINE,
  makePE,
  RVA,
  SECRETS,
  SECTION_SIZE,
  SECTIONS,
  sectionHeaderOffset,
  setDataDirectory,
  setRuntimeFunction,
  unwindCode,
  writeRuntimeFunction,
  writeUnwindInfo,
} from './pe-fixture'

const UNWIND_INFO_WITH_ONE_CODE = UNWIND_INFO_HEADER_SIZE + UNWIND_CODE_SIZE

const extract = (pe: Buffer) => {
  const result = extractPeUnwindInfo(pe)
  if (!result.data) {
    throw new Error('expected a reduced PE')
  }

  return {...result, data: result.data}
}

describe('reduced PE extraction', () => {
  test('keeps identity, the exception table and referenced unwind codes, and zeroes everything else', () => {
    const input = makePE()
    const original = Buffer.from(input)
    const {data: output, functions} = extract(input)

    expect(functions).toBe(1)
    expect(input).toEqual(original)
    const guidAndAge = RVA.codeView + CV_INFO_GUID_OFFSET
    const guidAndAgeSize = CV_INFO_PDB_FILENAME_OFFSET - CV_INFO_GUID_OFFSET
    expect(bytesAt(output, guidAndAge, guidAndAgeSize)).toEqual(bytesAt(input, guidAndAge, guidAndAgeSize))
    expect(bytesAt(output, RVA.exceptionTable, RUNTIME_FUNCTION_SIZE)).toEqual(
      bytesAt(input, RVA.exceptionTable, RUNTIME_FUNCTION_SIZE)
    )
    expect(bytesAt(output, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)).toEqual(
      bytesAt(input, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)
    )
    expect(bytesAt(output, RVA.unwindInfo + UNWIND_INFO_WITH_ONE_CODE, 2)).toEqual(Buffer.alloc(2))
    expect(bytesAt(output, RVA.code, SECTION_SIZE)).toEqual(Buffer.alloc(SECTION_SIZE))
    for (const secret of SECRETS) {
      expect(output.includes(Buffer.from(secret))).toBe(false)
    }
  })

  test('drops exception handler data and handler flags', () => {
    const input = makePE()
    const handler = writeUnwindInfo(input, RVA.unwindInfo, {flags: UNW_FLAG_EHANDLER})
    bytesAt(input, handler, 4).writeUInt32LE(0x1100)
    bytesAt(input, handler + 4, 14).write('HANDLER_SECRET')

    const {data: output} = extract(input)

    expect(bytesAt(output, RVA.unwindInfo, 1)[0]).toBe(1)
    expect(bytesAt(output, handler, 24)).toEqual(Buffer.alloc(24))
  })

  test('follows chained and indirect unwind records', () => {
    const input = makePE()
    const chainedFunction = writeUnwindInfo(input, RVA.unwindInfo, {flags: UNW_FLAG_CHAININFO})
    const indirectTarget = RVA.spare
    const parentUnwindInfo = RVA.spare + 0x20
    writeRuntimeFunction(input, chainedFunction, {...FUNCTION, unwind: indirect(indirectTarget)})
    writeRuntimeFunction(input, indirectTarget, {...FUNCTION, unwind: parentUnwindInfo})
    writeUnwindInfo(input, parentUnwindInfo, {codes: []})

    const {data: output} = extract(input)

    expect(bytesAt(output, chainedFunction, RUNTIME_FUNCTION_SIZE)).toEqual(
      bytesAt(input, chainedFunction, RUNTIME_FUNCTION_SIZE)
    )
    expect(bytesAt(output, indirectTarget, RUNTIME_FUNCTION_SIZE)).toEqual(
      bytesAt(input, indirectTarget, RUNTIME_FUNCTION_SIZE)
    )
    expect(bytesAt(output, parentUnwindInfo, 1)[0]).toBe(1)
  })

  test('follows indirect entries that point into the exception table', () => {
    const input = makePE()
    setDataDirectory(input, IMAGE_DIRECTORY_ENTRY_EXCEPTION, RVA.exceptionTable, 2 * RUNTIME_FUNCTION_SIZE)
    setRuntimeFunction(input, 1, {begin: 0x1020, end: 0x1040, unwind: indirect(RVA.exceptionTable)})

    const {data: output, functions} = extract(input)

    expect(functions).toBe(2)
    expect(bytesAt(output, RVA.exceptionTable, 2 * RUNTIME_FUNCTION_SIZE)).toEqual(
      bytesAt(input, RVA.exceptionTable, 2 * RUNTIME_FUNCTION_SIZE)
    )
  })

  test.each<[string, (pe: Buffer) => void, string]>([
    [
      'a cyclic unwind chain',
      (pe) => {
        const chainedFunction = writeUnwindInfo(pe, RVA.unwindInfo, {flags: UNW_FLAG_CHAININFO})
        writeRuntimeFunction(pe, chainedFunction, {...FUNCTION, unwind: RVA.unwindInfo})
      },
      'cyclic',
    ],
    [
      'an unmapped unwind RVA',
      (pe) => setRuntimeFunction(pe, 0, {...FUNCTION, unwind: 0xfffffffc}),
      'unmapped record RVA',
    ],
    [
      'unwind info inside the code section',
      (pe) => setRuntimeFunction(pe, 0, {...FUNCTION, unwind: RVA.code}),
      'code/executable section',
    ],
    [
      'an unsupported unwind version',
      (pe) => writeUnwindInfo(pe, RVA.unwindInfo, {version: 3}),
      'unsupported unwind version',
    ],
    [
      'an unsupported opcode',
      (pe) => writeUnwindInfo(pe, RVA.unwindInfo, {codes: [unwindCode(4, 11)]}),
      'unsupported unwind opcode',
    ],
    [
      'an opcode missing its operand slot',
      (pe) => writeUnwindInfo(pe, RVA.unwindInfo, {codes: [unwindCode(4, UWOP_ALLOC_LARGE, 0)]}),
      'truncated unwind opcode',
    ],
    [
      'overlapping sections',
      (pe) =>
        pe.writeUInt32LE(
          SECTIONS[1].fileOffset,
          sectionHeaderOffset(pe, 2) + IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET
        ),
      'overlapping raw sections',
    ],
    [
      'a missing exception table',
      (pe) => setDataDirectory(pe, IMAGE_DIRECTORY_ENTRY_EXCEPTION, 0, 0),
      'missing or invalid exception table',
    ],
    [
      'ARM64EC hybrid metadata',
      (pe) => {
        const loadConfigSize = IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET + 8
        setDataDirectory(pe, IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG, RVA.spare, loadConfigSize)
        bytesAt(pe, RVA.spare, 4).writeUInt32LE(loadConfigSize)
        bytesAt(pe, RVA.spare + IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET, 4).writeUInt32LE(0x1234)
      },
      'hybrid CHPE',
    ],
  ])('rejects %s without producing an artifact', (_name, mutate, message) => {
    const input = makePE()
    mutate(input)
    expect(() => extractPeUnwindInfo(input)).toThrow(message)
  })

  test('keeps version 2 epilog codes', () => {
    const input = makePE()
    writeUnwindInfo(input, RVA.unwindInfo, {version: 2, codes: [unwindCode(4, UWOP_EPILOG)]})

    expect(bytesAt(extract(input).data, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)).toEqual(
      bytesAt(input, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)
    )
  })

  test('x86 relies on the PDB and produces no PE artifact', () => {
    expect(extractPeUnwindInfo(makePE(MACHINE.x86))).toEqual({architecture: 'x86', functions: 0})
  })

  test.each(Object.entries(MACHINE).filter(([name]) => name !== 'x64' && name !== 'x86'))(
    'rejects unsupported machine %s',
    (_name, machine) => {
      expect(() => extractPeUnwindInfo(makePE(machine))).toThrow('unsupported machine')
    }
  )

  test('rejects unknown machines', () => {
    expect(() => extractPeUnwindInfo(makePE(0xffff))).toThrow('unsupported machine')
  })

  test('reduces a real x64 DLL', () => {
    const input = fs.readFileSync(`${__dirname}/fixtures/exports_with_pdb_64.dll`)
    expect(extractPeUnwindInfo(input).functions).toBeGreaterThan(0)
  })
})
