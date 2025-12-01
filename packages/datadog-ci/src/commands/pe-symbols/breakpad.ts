import fs from 'fs'
import readline from 'readline'

import {MachineArchitecture} from './pe-constants'
import {PEFileMetadata} from './pe'

type ModuleHeader = {
  os: string
  cpu: string
  id: string
  name: string
}

const cpuToArchitecture = (cpu: string): MachineArchitecture => {
  const normalized = cpu.toLowerCase()
  if (normalized === 'x86') {
    return MachineArchitecture.x86
  }
  if (normalized === 'x86_64' || normalized === 'amd64') {
    return MachineArchitecture.x64
  }
  if (normalized === 'arm64') {
    return MachineArchitecture.Arm64
  }
  if (normalized === 'arm' || normalized === 'armv7' || normalized === 'arm32') {
    return MachineArchitecture.Arm32
  }

  return MachineArchitecture.unknown
}

const formatGuid = (guidHex: string) =>
  `${guidHex.slice(0, 8)}-${guidHex.slice(8, 12)}-${guidHex.slice(12, 16)}-${guidHex.slice(16, 20)}-${guidHex.slice(20)}`

const parseModuleHeader = (line: string): ModuleHeader | undefined => {
  const trimmed = line.trim()
  if (!trimmed.length) {
    return undefined
  }
  if (!trimmed.startsWith('MODULE ')) {
    return undefined
  }
  const tokens = trimmed.split(/\s+/)
  if (tokens.length < 5) {
    throw new Error('Invalid MODULE header in Breakpad symbol file')
  }
  const [, os, cpu, id, ...rest] = tokens
  const name = rest.join(' ')

  return {os, cpu, id, name}
}

const readModuleHeader = async (pathname: string): Promise<ModuleHeader> => {
  const stream = fs.createReadStream(pathname, {encoding: 'utf8'})
  const rl = readline.createInterface({input: stream, crlfDelay: Infinity})

  try {
    for await (const line of rl) {
      const header = parseModuleHeader(line)
      if (header) {
        return header
      }
    }
  } finally {
    rl.close()
    stream.close()
  }

  throw new Error('Breakpad symbol file is missing MODULE header')
}

export const getBreakpadSymMetadata = async (pathname: string): Promise<PEFileMetadata> => {
  const header = await readModuleHeader(pathname)
  const identifier = header.id.toUpperCase()
  if (identifier.length <= 32) {
    throw new Error('Breakpad MODULE identifier is malformed')
  }
  if (!/^[0-9A-F]+$/.test(identifier)) {
    throw new Error('Breakpad MODULE identifier must be hexadecimal')
  }

  const guidHex = identifier.slice(0, 32)
  const ageHex = identifier.slice(32)
  if (guidHex.length !== 32 || ageHex.length === 0) {
    throw new Error('Breakpad MODULE identifier must contain GUID and age')
  }

  const pdbAge = Number.parseInt(ageHex, 16)
  if (Number.isNaN(pdbAge)) {
    throw new Error('Breakpad MODULE age is not hexadecimal')
  }

  const metadata: PEFileMetadata = {
    filename: pathname,
    isPE: false,
    arch: cpuToArchitecture(header.cpu),
    hasPdbInfo: true,
    pdbAge,
    pdbSig: formatGuid(guidHex),
    pdbFilename: header.name,
    sourceType: 'breakpad_sym',
    symbolPath: pathname,
  }

  return metadata
}

