import {promises} from 'fs'

export enum AppleSymbolPlatform {
  MACOS = 'macos',
}

const MACH_HEADER_32_SIZE = 28
const MACH_HEADER_64_SIZE = 32
const LOAD_COMMAND_HEADER_SIZE = 8
const MAX_LOAD_COMMANDS_SIZE = 16 * 1024 * 1024

const LC_BUILD_VERSION = 0x32
const LC_VERSION_MIN_MACOSX = 0x24
const PLATFORM_MACOS = 1

interface MachOFormat {
  headerSize: number
  littleEndian: boolean
}

const getMachOFormat = (data: Buffer): MachOFormat | undefined => {
  if (data.length < MACH_HEADER_32_SIZE) {
    return undefined
  }

  const magic = data.subarray(0, 4).toString('hex')
  switch (magic) {
    case 'cefaedfe':
      return {headerSize: MACH_HEADER_32_SIZE, littleEndian: true}
    case 'cffaedfe':
      return {headerSize: MACH_HEADER_64_SIZE, littleEndian: true}
    case 'feedface':
      return {headerSize: MACH_HEADER_32_SIZE, littleEndian: false}
    case 'feedfacf':
      return {headerSize: MACH_HEADER_64_SIZE, littleEndian: false}
    default:
      return undefined
  }
}

const readUInt32 = (data: Buffer, offset: number, littleEndian: boolean) =>
  littleEndian ? data.readUInt32LE(offset) : data.readUInt32BE(offset)

export const detectAppleSymbolPlatform = (data: Buffer): AppleSymbolPlatform | undefined => {
  const format = getMachOFormat(data)
  if (format === undefined || data.length < format.headerSize) {
    return undefined
  }

  const numberOfCommands = readUInt32(data, 16, format.littleEndian)
  const commandsSize = readUInt32(data, 20, format.littleEndian)
  const commandsEnd = format.headerSize + commandsSize
  if (commandsEnd > data.length) {
    return undefined
  }

  let offset = format.headerSize
  for (let index = 0; index < numberOfCommands; index++) {
    if (offset + LOAD_COMMAND_HEADER_SIZE > commandsEnd) {
      return undefined
    }

    const command = readUInt32(data, offset, format.littleEndian)
    const commandSize = readUInt32(data, offset + 4, format.littleEndian)
    if (commandSize < LOAD_COMMAND_HEADER_SIZE || offset + commandSize > commandsEnd) {
      return undefined
    }

    if (command === LC_BUILD_VERSION) {
      if (commandSize < 12) {
        return undefined
      }

      const platform = readUInt32(data, offset + 8, format.littleEndian)

      return platform === PLATFORM_MACOS ? AppleSymbolPlatform.MACOS : undefined
    }

    if (command === LC_VERSION_MIN_MACOSX) {
      return AppleSymbolPlatform.MACOS
    }

    offset += commandSize
  }

  return undefined
}

export const detectAppleSymbolPlatformFromFile = async (
  objectPath: string
): Promise<AppleSymbolPlatform | undefined> => {
  let file: Awaited<ReturnType<typeof promises.open>> | undefined
  try {
    file = await promises.open(objectPath, 'r')
    const header = Buffer.alloc(MACH_HEADER_64_SIZE)
    const {bytesRead: headerBytesRead} = await file.read(header, 0, header.length, 0)
    const format = getMachOFormat(header.subarray(0, headerBytesRead))
    if (format === undefined) {
      return undefined
    }

    const commandsSize = readUInt32(header, 20, format.littleEndian)
    if (commandsSize > MAX_LOAD_COMMANDS_SIZE) {
      return undefined
    }

    const dataSize = format.headerSize + commandsSize
    const data = Buffer.alloc(dataSize)
    const {bytesRead} = await file.read(data, 0, data.length, 0)
    if (bytesRead !== data.length) {
      return undefined
    }

    return detectAppleSymbolPlatform(data)
  } catch {
    // Platform metadata is an optional enrichment. Preserve existing dSYM upload behavior if it cannot be read.
    return undefined
  } finally {
    await file?.close()
  }
}
