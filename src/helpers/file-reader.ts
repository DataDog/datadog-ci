import fs from 'fs'

export class FileReader {
  private fd: fs.promises.FileHandle
  private buffer?: Buffer

  constructor(fd: fs.promises.FileHandle) {
    this.fd = fd
  }

  public async read(length: number, position = 0): Promise<Buffer> {
    if (!this.buffer || this.buffer.length < length) {
      this.buffer = Buffer.alloc(length)
    }
    const {buffer, bytesRead} = await this.fd.read(this.buffer, 0, length, position)

    return buffer.subarray(0, bytesRead)
  }

  // XXX: Use `Symbol.asyncDispose` and `using async` when available
  public async close(): Promise<void> {
    await this.fd.close()
  }
}

export const createReaderFromFile = async (filename: string): Promise<FileReader> => {
  const fd = await fs.promises.open(filename, 'r')

  return new FileReader(fd)
}

export const createReadFunctions = (buffer: Buffer, littleEndian: boolean, is32bit: boolean) => {
  let position = 0

  const readAndIncrementPos = <T>(inc: number, read: (offset: number) => T) => {
    const value = read(position)
    position += inc

    return value
  }

  const bufferReadUInt16 = (littleEndian ? buffer.readUInt16LE : buffer.readUInt16BE).bind(buffer)
  const bufferReadUInt32 = (littleEndian ? buffer.readUInt32LE : buffer.readUInt32BE).bind(buffer)
  const bufferReadBigUInt64 = (littleEndian ? buffer.readBigUInt64LE : buffer.readBigUInt64BE).bind(buffer)

  const readUInt16 = () => readAndIncrementPos(2, bufferReadUInt16)
  const readUInt32 = () => readAndIncrementPos(4, bufferReadUInt32)
  const readBigUInt64 = () => readAndIncrementPos(8, bufferReadBigUInt64)

  const readBigUInt32Or64 = is32bit ? () => BigInt(readUInt32()) : readBigUInt64

  return {readUInt16, readUInt32, readBigUInt32Or64}
}
