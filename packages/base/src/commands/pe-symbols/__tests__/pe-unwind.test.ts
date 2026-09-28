import fs from 'fs'

import {
  CV_INFO_GUID_OFFSET,
  CV_INFO_PDB_FILENAME_OFFSET,
  IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET,
  IMAGE_DIRECTORY_ENTRY_EXCEPTION,
  IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG,
  IMAGE_LOAD_CONFIG64_CHPE_METADATA_OFFSET,
  IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET,
  RUNTIME_FUNCTION_SIZE,
  UNW_FLAG_CHAININFO,
  UNW_FLAG_EHANDLER,
  UNWIND_CODE_SIZE,
  UNWIND_INFO_COUNT_OF_CODES_OFFSET,
  UNWIND_INFO_HEADER_SIZE,
  UWOP_ALLOC_LARGE,
  UWOP_ALLOC_SMALL,
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
  setCodeViewFilename,
  setDataDirectory,
  setDataDirectoryCount,
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

  test.each(['', 'x', 'xy', 'xyz', 'xyzw', 'abcde', 'original.pdb'])(
    'accepts RSDS filename %j without copying adjacent data',
    (filename) => {
      const input = makePE()
      setCodeViewFilename(input, filename)
      const inputSize = CV_INFO_PDB_FILENAME_OFFSET + filename.length + 1
      bytesAt(input, RVA.codeView + inputSize, 6).write('SECRET')

      const {data: output} = extract(input)
      const outputSize = bytesAt(output, RVA.debugDirectory + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET, 4).readUInt32LE()
      expect(outputSize).toBeLessThanOrEqual(inputSize)
      expect(bytesAt(output, RVA.codeView, CV_INFO_PDB_FILENAME_OFFSET)).toEqual(
        bytesAt(input, RVA.codeView, CV_INFO_PDB_FILENAME_OFFSET)
      )
      const name = bytesAt(output, RVA.codeView + CV_INFO_PDB_FILENAME_OFFSET, outputSize - CV_INFO_PDB_FILENAME_OFFSET)
      expect(name.toString()).toBe(`${'_.pdb'.slice(0, filename.length)}\0`)
      expect(output.includes(Buffer.from('SECRET'))).toBe(false)
    }
  )

  test.each([CV_INFO_PDB_FILENAME_OFFSET - 1, CV_INFO_PDB_FILENAME_OFFSET])(
    'rejects a truncated RSDS record of %i bytes',
    (size) => {
      const input = makePE()
      bytesAt(input, RVA.debugDirectory + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET, 4).writeUInt32LE(size)
      expect(() => extractPeUnwindInfo(input)).toThrow('invalid RSDS identity')
    }
  )

  test('rejects an RSDS filename terminated only outside its declared record', () => {
    const input = makePE()
    setCodeViewFilename(input, 'x')
    bytesAt(input, RVA.codeView + CV_INFO_PDB_FILENAME_OFFSET, 3).set([0x78, 0x79, 0])

    expect(() => extractPeUnwindInfo(input)).toThrow('unterminated RSDS filename')
  })

  test('rejects an inflated unwind code count that includes adjacent private data', () => {
    const input = makePE()
    bytesAt(input, RVA.unwindInfo + UNWIND_INFO_HEADER_SIZE + UNWIND_CODE_SIZE, UNWIND_CODE_SIZE).fill(0)
    bytesAt(input, RVA.unwindInfo + UNWIND_INFO_HEADER_SIZE + 2 * UNWIND_CODE_SIZE, 6).write('SECRET')

    // With the original count, padding and the adjacent bytes are excluded.
    expect(extract(input).data.includes(Buffer.from('SECRET'))).toBe(false)

    // Padding becomes PUSH_NONVOL; SECRET becomes a three-slot SAVE_NONVOL_FAR.
    // The opcode widths fit, but its CodeOffset (83) exceeds SizeOfProlog (4).
    bytesAt(input, RVA.unwindInfo + UNWIND_INFO_COUNT_OF_CODES_OFFSET, 1)[0] = 5

    expect(() => extractPeUnwindInfo(input)).toThrow('unwind code offset exceeds prolog size')
  })

  test.each([1, 2])('keeps version %i operand slots whose bytes exceed the prolog size', (version) => {
    const input = makePE()
    writeUnwindInfo(input, RVA.unwindInfo, {
      version,
      codes: [unwindCode(4, UWOP_ALLOC_LARGE), [0x80, 0]],
    })
    const size = UNWIND_INFO_HEADER_SIZE + 2 * UNWIND_CODE_SIZE

    expect(bytesAt(extract(input).data, RVA.unwindInfo, size)).toEqual(bytesAt(input, RVA.unwindInfo, size))
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

  test('keeps version 2 epilog codes whose offset exceeds the prolog size', () => {
    const input = makePE()
    writeUnwindInfo(input, RVA.unwindInfo, {version: 2, prologSize: 4, codes: [unwindCode(16, UWOP_EPILOG, 1)]})

    expect(bytesAt(extract(input).data, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)).toEqual(
      bytesAt(input, RVA.unwindInfo, UNWIND_INFO_WITH_ONE_CODE)
    )
  })

  test('rejects a version 2 prolog offset beyond the prolog size after an epilog code', () => {
    const input = makePE()
    writeUnwindInfo(input, RVA.unwindInfo, {
      version: 2,
      prologSize: 4,
      codes: [unwindCode(16, UWOP_EPILOG, 1), unwindCode(5, UWOP_ALLOC_SMALL, 3)],
    })

    expect(() => extractPeUnwindInfo(input)).toThrow('unwind code offset exceeds prolog size')
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

  test.each([7, 10, 11, 15])('accepts a standard-sized optional header declaring %i data directories', (count) => {
    const input = makePE()
    const expected = extract(input)
    setDataDirectoryCount(input, count)

    expect(extract(input)).toEqual(expected)
  })

  test('does not read an undeclared load-config directory', () => {
    const input = makePE()
    setDataDirectory(input, IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG, 0xffffffff, 0xffffffff)
    setDataDirectoryCount(input, 7)

    expect(extract(input).functions).toBe(1)
  })

  test('rejects an undeclared debug directory even when its bytes are present', () => {
    const input = makePE()
    setDataDirectoryCount(input, 6)

    expect(() => extractPeUnwindInfo(input)).toThrow('missing or invalid debug directory')
  })

  test('rejects a directory count exceeding the supported optional-header capacity', () => {
    const input = makePE()
    setDataDirectoryCount(input, 17)

    expect(() => extractPeUnwindInfo(input)).toThrow('data directory count exceeds supported optional-header capacity')
  })

  test('accepts an x86 image with no data directories', () => {
    const input = makePE(MACHINE.x86)
    setDataDirectoryCount(input, 0)

    expect(extractPeUnwindInfo(input)).toEqual({architecture: 'x86', functions: 0})
  })

  test('reduces a real x64 DLL', () => {
    const input = fs.readFileSync(`${__dirname}/fixtures/exports_with_pdb_64.dll`)
    const expected = extract(input)
    expect(expected.functions).toBeGreaterThan(0)
    setDataDirectoryCount(input, 15)
    expect(extract(input)).toEqual(expected)
  })
})
