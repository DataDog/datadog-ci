import fs from 'fs'

import {extractPeUnwindInfo} from '../pe-unwind'

import {makePE} from './pe-fixture'

describe('reduced PE extraction', () => {
  test('preserves x64 identity and referenced records, removing code, paths, padding and unrelated data', () => {
    const input = makePE()
    const original = Buffer.from(input)
    const result = extractPeUnwindInfo(input)
    const output = result.data!
    expect(result.functions).toBe(1)
    expect(input).toEqual(original)
    expect(output.subarray(0x444, 0x458)).toEqual(input.subarray(0x444, 0x458))
    expect(output.subarray(0x600, 0x60c)).toEqual(input.subarray(0x600, 0x60c))
    expect(output.subarray(0x500, 0x506)).toEqual(input.subarray(0x500, 0x506))
    expect(output.subarray(0x506, 0x508)).toEqual(Buffer.alloc(2))
    expect(output.subarray(0x200, 0x400)).toEqual(Buffer.alloc(0x200))
    for (const secret of ['DOS_SECRET', 'PRIVATE_DATA', 'PRIVATE_PATH', 'original.pdb']) {
      expect(output.includes(Buffer.from(secret))).toBe(false)
    }
  })

  test('drops exception handler data and handler flags', () => {
    const input = makePE()
    input[0x500] = 9
    input.writeUInt32LE(0x1100, 0x508)
    input.write('HANDLER_SECRET', 0x50c)
    const output = extractPeUnwindInfo(input).data!
    expect(output[0x500]).toBe(1)
    expect(output.subarray(0x508, 0x520)).toEqual(Buffer.alloc(24))
  })

  test('follows chained and indirect unwind records', () => {
    const input = makePE()
    input[0x500] = 33
    input.writeUInt32LE(0x1000, 0x508)
    input.writeUInt32LE(0x1020, 0x50c)
    input.writeUInt32LE(0x2121, 0x510)
    input.writeUInt32LE(0x1000, 0x520)
    input.writeUInt32LE(0x1020, 0x524)
    input.writeUInt32LE(0x2140, 0x528)
    input.set([1, 0, 0, 0], 0x540)
    const output = extractPeUnwindInfo(input).data!
    expect(output.subarray(0x508, 0x514)).toEqual(input.subarray(0x508, 0x514))
    expect(output.subarray(0x520, 0x52c)).toEqual(input.subarray(0x520, 0x52c))
    expect(output[0x540]).toBe(1)
  })

  test('follows indirect entries that point into the exception table', () => {
    const input = makePE()
    input.writeUInt32LE(24, 0x108 + 3 * 8 + 4)
    input.writeUInt32LE(0x1020, 0x60c)
    input.writeUInt32LE(0x1040, 0x610)
    input.writeUInt32LE(0x3001, 0x614)
    const result = extractPeUnwindInfo(input)
    expect(result.functions).toBe(2)
    expect(result.data!.subarray(0x600, 0x618)).toEqual(input.subarray(0x600, 0x618))
  })

  test.each<[string, (buffer: Buffer) => void]>([
    [
      'cycle',
      (b: Buffer) => {
        b[0x500] = 33
        b.writeUInt32LE(0x2100, 0x510)
      },
    ],
    ['unmapped RVA', (b: Buffer) => b.writeUInt32LE(0xfffffffc, 0x608)],
    ['metadata in code', (b: Buffer) => b.writeUInt32LE(0x1000, 0x608)],
    [
      'unsupported version',
      (b: Buffer) => {
        b[0x500] = 3
      },
    ],
    [
      'unsupported opcode',
      (b: Buffer) => {
        b[0x505] = 11
      },
    ],
    [
      'truncated opcode',
      (b: Buffer) => {
        b[0x505] = 1
      },
    ],
    ['overlap', (b: Buffer) => b.writeUInt32LE(0x400, 0x188 + 80 + 20)],
    ['missing unwind data', (b: Buffer) => b.writeUInt32LE(0, 0x108 + 3 * 8)],
    [
      'hybrid CHPE',
      (b: Buffer) => {
        b.writeUInt32LE(0x2100, 0x108 + 10 * 8)
        b.writeUInt32LE(208, 0x108 + 10 * 8 + 4)
        b.writeUInt32LE(208, 0x500)
        b.writeUInt32LE(0x1234, 0x5c8)
      },
    ],
  ])('rejects %s without producing an artifact', (_name, mutate) => {
    const input = makePE()
    mutate(input)
    expect(() => extractPeUnwindInfo(input)).toThrow()
  })

  test('preserves version 2 epilog records', () => {
    const input = makePE()
    input[0x500] = 2
    input[0x505] = 6
    expect(extractPeUnwindInfo(input).data!.subarray(0x500, 0x506)).toEqual(input.subarray(0x500, 0x506))
  })

  test('x86 uses PDB-only and produces no PE artifact', () => {
    expect(extractPeUnwindInfo(makePE(0x14c))).toEqual({architecture: 'x86', functions: 0})
  })

  test.each([0x1c0, 0x1c4, 0xaa64, 0xa641, 0xa64e, 0xffff])('rejects unsupported machine: %s', (machine) => {
    expect(() => extractPeUnwindInfo(makePE(machine))).toThrow('unsupported machine')
  })

  test('existing x64 DLL can be reduced', () => {
    const input = fs.readFileSync(`${__dirname}/fixtures/exports_with_pdb_64.dll`)
    expect(extractPeUnwindInfo(input).functions).toBeGreaterThan(0)
  })
})
