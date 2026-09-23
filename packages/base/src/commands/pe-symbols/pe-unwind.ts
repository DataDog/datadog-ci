/* eslint-disable no-bitwise -- PE records contain packed bit fields. */
import fs from 'fs'

/** PE record filter for unwind uploads. Native conversion remains server-side. */
export interface ReducedPE {
  architecture: 'x86' | 'x64'
  data?: Buffer
  functions: number
}

const requireValid: (condition: boolean, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(`Cannot extract PE unwind data: ${message}`)
  }
}

/**
 * Keeps original RVAs/file mappings, but starts with zero-filled storage and rebuilds
 * headers. Only RSDS identity, runtime functions and reachable unwind records survive.
 * This is a parser input, not an executable or an exception-dispatch-capable image.
 */
export const extractPeUnwindInfo = (input: Buffer): ReducedPE => {
  const bounds = (offset: number, size: number) => {
    requireValid(
      Number.isSafeInteger(offset) && offset >= 0 && size >= 0 && offset + size <= input.length,
      'out-of-bounds record'
    )
  }
  const u16 = (offset: number) => {
    bounds(offset, 2)

    return input.readUInt16LE(offset)
  }
  const u32 = (offset: number) => {
    bounds(offset, 4)

    return input.readUInt32LE(offset)
  }
  requireValid(u16(0) === 0x5a4d, 'invalid DOS signature')
  const pe = u32(60)
  requireValid(pe >= 64 && pe <= 4096 && u32(pe) === 0x4550, 'invalid PE header')
  const machine = u16(pe + 4)
  requireValid(
    machine === 0x8664 || machine === 0x14c,
    `unsupported machine 0x${machine.toString(16)} (only x64 and x86 are supported)`
  )
  const architecture = machine === 0x8664 ? 'x64' : 'x86'
  const optional = pe + 24
  const is64 = architecture === 'x64'
  const optionalSize = is64 ? 240 : 224
  requireValid(u16(pe + 20) === optionalSize && u16(optional) === (is64 ? 0x20b : 0x10b), 'unsupported optional header')
  const directories = optional + (is64 ? 112 : 96)
  requireValid(u32(directories - 4) === 16, 'expected 16 data directories')
  const sectionTable = optional + optionalSize
  const sectionCount = u16(pe + 6)
  const headerSize = u32(optional + 60)
  const imageSize = u32(optional + 56)
  requireValid(sectionCount > 0 && sectionCount <= 96, 'invalid section count')
  requireValid(headerSize >= sectionTable + sectionCount * 40 && headerSize <= input.length, 'invalid header size')
  const sections = Array.from({length: sectionCount}, (_, i) => {
    const off = sectionTable + i * 40
    const section = {
      off,
      virtualSize: u32(off + 8),
      rva: u32(off + 12),
      size: u32(off + 16),
      raw: u32(off + 20),
      flags: u32(off + 36),
    }
    bounds(section.raw, section.size)
    requireValid(section.size === 0 || section.raw >= headerSize, 'section overlaps headers')
    requireValid(
      section.rva >= headerSize && section.rva + Math.max(section.size, section.virtualSize) <= imageSize,
      'invalid section address range'
    )

    return section
  })
  for (let i = 0; i < sections.length; i++) {
    for (const other of sections.slice(i + 1)) {
      const current = sections[i]
      requireValid(
        !current.size ||
          !other.size ||
          current.raw + current.size <= other.raw ||
          other.raw + other.size <= current.raw,
        'overlapping raw sections'
      )
      requireValid(
        current.rva + Math.max(current.size, current.virtualSize) <= other.rva ||
          other.rva + Math.max(other.size, other.virtualSize) <= current.rva,
        'overlapping virtual sections'
      )
    }
  }
  const offsetOf = (rva: number, size: number): number => {
    const section = sections.find((s) => rva >= s.rva && rva + size <= s.rva + s.size)
    requireValid(section !== undefined, 'unmapped record RVA')
    requireValid((section.flags & 0x20000020) === 0, 'metadata in a code/executable section is unsupported')

    return section.raw + rva - section.rva
  }
  const directory = (index: number): [number, number] => [
    u32(directories + index * 8),
    u32(directories + index * 8 + 4),
  ]
  // ARM64EC images use the x64 machine type but keep alternate unwind tables in load-config metadata.
  const [loadRva, loadSize] = directory(10)
  if (loadRva && loadSize) {
    const chpeOffset = is64 ? 200 : 124
    if (loadSize >= chpeOffset + (is64 ? 8 : 4)) {
      const load = offsetOf(loadRva, loadSize)
      if (u32(load) >= chpeOffset + (is64 ? 8 : 4)) {
        requireValid(
          u32(load + chpeOffset) === 0 && (!is64 || u32(load + chpeOffset + 4) === 0),
          'hybrid CHPE/ARM64EC metadata is unsupported'
        )
      }
    }
  }
  // x86 unwind information comes from PDB frame-data/FPO. Never attach an empty PE.
  if (architecture === 'x86') {
    return {architecture, functions: 0}
  }
  const [pdataRva, pdataSize] = directory(3)
  requireValid(pdataRva > 0 && pdataSize > 0 && pdataSize % 12 === 0, 'missing or invalid exception table')
  const pdata = offsetOf(pdataRva, pdataSize)
  const outputSize = Math.max(headerSize, ...sections.map((s) => (s.size ? s.raw + s.size : 0)))
  const output = Buffer.alloc(outputSize)
  const copied = new Map<number, number>()
  const copyRecord = (offset: number, size: number) => {
    bounds(offset, size)
    requireValid(!copied.has(offset), 'overlapping metadata records')
    copied.set(offset, size)
    input.copy(output, offset, offset, offset + size)
  }
  // Reconstruct essential headers; do not copy DOS stub, Rich header, names, slack,
  // entry point, symbol tables, certificates, resources or unused data directories.
  output.writeUInt16LE(0x5a4d, 0)
  output.writeUInt32LE(pe, 60)
  output.writeUInt32LE(0x4550, pe)
  output.writeUInt16LE(machine, pe + 4)
  output.writeUInt16LE(sectionCount, pe + 6)
  output.writeUInt32LE(u32(pe + 8), pe + 8)
  output.writeUInt16LE(optionalSize, pe + 20)
  output.writeUInt16LE(0x22, pe + 22)
  output.writeUInt16LE(0x20b, optional)
  // Image base, section/file alignment, image size and header size.
  input.copy(output, optional + 24, optional + 24, optional + 40)
  output.writeUInt32LE(imageSize, optional + 56)
  output.writeUInt32LE(headerSize, optional + 60)
  output.writeUInt16LE(3, optional + 68)
  output.writeUInt32LE(16, directories - 4)
  for (const [i, section] of sections.entries()) {
    output.write(`.s${i}`, section.off, 8, 'ascii')
    for (const [off, value] of [
      [8, section.virtualSize],
      [12, section.rva],
      [16, section.size],
      [20, section.raw],
    ]) {
      output.writeUInt32LE(value, section.off + off)
    }
    output.writeUInt32LE(0x40000040, section.off + 36)
  }
  const [debugRva, debugSize] = directory(6)
  requireValid(
    debugRva > 0 && debugSize > 0 && debugSize % 28 === 0 && debugSize <= 28 * 128,
    'invalid debug directory'
  )
  const debug = offsetOf(debugRva, debugSize)
  const codeViews = Array.from({length: debugSize / 28}, (_, i) => debug + i * 28).filter((off) => u32(off + 12) === 2)
  requireValid(codeViews.length === 1, 'expected one CodeView identity')
  const cvDirectory = codeViews[0]
  const cvSize = u32(cvDirectory + 16)
  const cvRva = u32(cvDirectory + 20)
  const cv = offsetOf(cvRva, cvSize)
  requireValid(cvSize >= 30 && cv === u32(cvDirectory + 24) && u32(cv) === 0x53445352, 'invalid RSDS identity')
  copyRecord(cvDirectory, 28)
  output.fill(0, cvDirectory, cvDirectory + 28)
  output.writeUInt32LE(2, cvDirectory + 12)
  output.writeUInt32LE(30, cvDirectory + 16)
  output.writeUInt32LE(cvRva, cvDirectory + 20)
  output.writeUInt32LE(cv, cvDirectory + 24)
  copyRecord(cv, 30)
  output.write('_.pdb\0', cv + 24, 'ascii')
  output.writeUInt32LE(debugRva + cvDirectory - debug, directories + 6 * 8)
  output.writeUInt32LE(28, directories + 6 * 8 + 4)
  copyRecord(pdata, pdataSize)
  output.writeUInt32LE(pdataRva, directories + 3 * 8)
  output.writeUInt32LE(pdataSize, directories + 3 * 8 + 4)
  const visited = new Set<number>()
  const active = new Set<number>()
  const x64Unwind = (rva: number, depth = 0): void => {
    requireValid(depth <= 64 && !active.has(rva), 'cyclic or excessively deep unwind chain')
    if (visited.has(rva)) {
      return
    }
    active.add(rva)
    if (rva & 1) {
      const indirect = offsetOf(rva - 1, 12)
      // Indirect entries normally point at another runtime function, already copied with the table.
      if (indirect < pdata || indirect >= pdata + pdataSize) {
        copyRecord(indirect, 12)
      } else {
        requireValid((indirect - pdata) % 12 === 0, 'unaligned indirect runtime function')
      }
      x64Unwind(u32(indirect + 8), depth + 1)
    } else {
      requireValid(rva > 0 && rva % 4 === 0, 'unaligned unwind record')
      const off = offsetOf(rva, 4)
      const flags = input[off] >>> 3
      const count = input[off + 2]
      const version = input[off] & 7
      requireValid([1, 2].includes(version) && flags <= 4, 'unsupported unwind version or flags')
      const codesSize = 4 + 2 * count
      const alignedSize = (codesSize + 3) & ~3
      offsetOf(rva, alignedSize + (flags === 4 ? 12 : flags & 3 ? 4 : 0))
      // Validate opcode slot widths instead of blindly copying an advertised byte range.
      for (let slot = 0; slot < count; ) {
        const code = input[off + 5 + slot * 2]
        const op = code & 15
        const info = code >>> 4
        requireValid(op <= 10, 'unsupported unwind opcode')
        requireValid(op !== 1 || info <= 1, 'invalid ALLOC_LARGE')
        requireValid(op !== 10 || info <= 1, 'invalid PUSH_MACHFRAME')
        slot +=
          op === 1
            ? info === 0
              ? 2
              : 3
            : op === 6
              ? version === 1
                ? 2
                : 1
              : [4, 8].includes(op)
                ? 2
                : [5, 7, 9].includes(op)
                  ? 3
                  : 1
        requireValid(slot <= count, 'truncated unwind opcode')
      }
      copyRecord(off, codesSize)
      // Handler-specific data is not used by our CFI converter. Remove handler flags
      // and pointers; leave alignment padding zero. Preserve chain records only.
      output[off] = version | (flags === 4 ? 4 << 3 : 0)
      if (flags === 4) {
        copyRecord(off + alignedSize, 12)
        x64Unwind(u32(off + alignedSize + 8), depth + 1)
      }
    }
    active.delete(rva)
    visited.add(rva)
  }
  let functions = 0
  for (let off = pdata; off < pdata + pdataSize; off += 12) {
    const begin = u32(off)
    if (begin === 0 && u32(off + 4) === 0 && u32(off + 8) === 0) {
      continue
    }
    requireValid(begin > 0 && begin < imageSize, 'invalid function address')
    requireValid(u32(off + 4) > begin && u32(off + 4) <= imageSize, 'invalid function range')
    x64Unwind(u32(off + 8))
    functions++
  }
  requireValid(functions > 0, 'empty exception table')
  const ranges = [...copied].sort(([a], [b]) => a - b)
  for (let i = 1; i < ranges.length; i++) {
    requireValid(ranges[i - 1][0] + ranges[i - 1][1] <= ranges[i][0], 'overlapping metadata records')
  }

  return {architecture, data: output, functions}
}

export const copyPeUnwindInfo = async (filename: string, outputFile: string): Promise<ReducedPE> => {
  const result = extractPeUnwindInfo(await fs.promises.readFile(filename))
  if (result.data) {
    await fs.promises.writeFile(outputFile, result.data, {flag: 'wx', mode: 0o600})
  }

  return result
}
