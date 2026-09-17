import {AppleSymbolPlatform, detectAppleSymbolPlatform} from '../macho'

const LC_BUILD_VERSION = 0x32
const LC_VERSION_MIN_MACOSX = 0x24

const makeMachO = ({
  command,
  littleEndian = true,
  platform,
  sixtyFourBit = true,
}: {
  command: number
  littleEndian?: boolean
  platform?: number
  sixtyFourBit?: boolean
}) => {
  const headerSize = sixtyFourBit ? 32 : 28
  const commandSize = command === LC_BUILD_VERSION ? 24 : 16
  const data = Buffer.alloc(headerSize + commandSize)
  const writeUInt32 = littleEndian ? data.writeUInt32LE.bind(data) : data.writeUInt32BE.bind(data)

  Buffer.from(
    littleEndian ? (sixtyFourBit ? 'cffaedfe' : 'cefaedfe') : sixtyFourBit ? 'feedfacf' : 'feedface',
    'hex'
  ).copy(data)
  writeUInt32(1, 16)
  writeUInt32(commandSize, 20)
  writeUInt32(command, headerSize)
  writeUInt32(commandSize, headerSize + 4)
  if (platform !== undefined) {
    writeUInt32(platform, headerSize + 8)
  }

  return data
}

describe('detectAppleSymbolPlatform', () => {
  test('detects macOS from a little-endian 64-bit LC_BUILD_VERSION command', () => {
    const data = makeMachO({command: LC_BUILD_VERSION, platform: 1})

    expect(detectAppleSymbolPlatform(data)).toBe(AppleSymbolPlatform.MACOS)
  })

  test('detects macOS from a big-endian 32-bit legacy version command', () => {
    const data = makeMachO({command: LC_VERSION_MIN_MACOSX, littleEndian: false, sixtyFourBit: false})

    expect(detectAppleSymbolPlatform(data)).toBe(AppleSymbolPlatform.MACOS)
  })

  test('does not identify iOS as macOS', () => {
    const data = makeMachO({command: LC_BUILD_VERSION, platform: 2})

    expect(detectAppleSymbolPlatform(data)).toBeUndefined()
  })

  test('returns undefined for a malformed Mach-O', () => {
    const data = makeMachO({command: LC_BUILD_VERSION, platform: 1}).subarray(0, 40)

    expect(detectAppleSymbolPlatform(data)).toBeUndefined()
  })
})
