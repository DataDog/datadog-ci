// Synthetic PE with code, mixed metadata/data, and an exception table in separate
// sections. Sentinels cover data which must never survive extraction.
export const makePE = (machine = 0x8664): Buffer => {
  const data = Buffer.alloc(0x800)
  const is64 = machine !== 0x14c
  const optional = 0x98
  const directories = optional + (is64 ? 112 : 96)
  const optionalSize = is64 ? 240 : 224
  const sections = optional + optionalSize
  data.writeUInt16LE(0x5a4d)
  data.writeUInt32LE(0x80, 60)
  data.write('DOS_SECRET', 64)
  data.writeUInt32LE(0x4550, 0x80)
  data.writeUInt16LE(machine, 0x84)
  data.writeUInt16LE(3, 0x86)
  data.writeUInt32LE(123456, 0x88)
  data.writeUInt16LE(optionalSize, 0x94)
  data.writeUInt16LE(is64 ? 0x20b : 0x10b, optional)
  if (is64) {
    data.writeBigUInt64LE(BigInt('0x140000000'), optional + 24)
  } else {
    data.writeUInt32LE(0x400000, optional + 28)
  }
  data.writeUInt32LE(0x1000, optional + 32)
  data.writeUInt32LE(0x200, optional + 36)
  data.writeUInt32LE(0x4000, optional + 56)
  data.writeUInt32LE(0x200, optional + 60)
  data.writeUInt32LE(16, directories - 4)
  for (let i = 0; i < 3; i++) {
    const off = sections + i * 40
    data.write(['.text', '.rdata', '.pdata'][i], off)
    data.writeUInt32LE(0x200, off + 8)
    data.writeUInt32LE((i + 1) * 0x1000, off + 12)
    data.writeUInt32LE(0x200, off + 16)
    data.writeUInt32LE((i + 1) * 0x200, off + 20)
    data.writeUInt32LE(i === 0 ? 0x60000020 : 0x40000040, off + 36)
  }
  data.fill(0xcc, 0x200, 0x400)
  data.write('PRIVATE_DATA', 0x480)
  data.writeUInt32LE(0x2000, directories + 6 * 8)
  data.writeUInt32LE(28, directories + 6 * 8 + 4)
  data.writeUInt32LE(2, 0x40c)
  data.writeUInt32LE(60, 0x410)
  data.writeUInt32LE(0x2040, 0x414)
  data.writeUInt32LE(0x440, 0x418)
  data.write('RSDS', 0x440)
  data.fill(0xab, 0x444, 0x454)
  data.writeUInt32LE(1, 0x454)
  data.write('C:\\PRIVATE_PATH\\original.pdb\0', 0x458)
  data.writeUInt32LE(0x3000, directories + 3 * 8)
  data.writeUInt32LE(12, directories + 3 * 8 + 4)
  data.writeUInt32LE(0x1000, 0x600)
  data.writeUInt32LE(0x1020, 0x604)
  data.writeUInt32LE(0x2100, 0x608)
  data.set([1, 4, 1, 0, 4, 0x32, 0xde, 0xad], 0x500)

  return data
}
