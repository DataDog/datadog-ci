import fs from 'fs'

import type {Reader} from './filereader'

import {FileReader} from './filereader'
import {
  CV_INFO_AGE_OFFSET,
  CV_INFO_GUID_OFFSET,
  CV_INFO_PDB_FILENAME_OFFSET,
  CV_INFO_SIGNATURE_OFFSET,
  DOS_HEADER_LFANEW_OFFSET,
  DOS_HEADER_SIZE,
  IMAGE_DATA_DIRECTORY32_OFFSET,
  IMAGE_DATA_DIRECTORY64_OFFSET,
  IMAGE_DATA_DIRECTORY_SIZE,
  IMAGE_DATA_DIRECTORY_SIZE_OFFSET,
  IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET,
  IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_SIZE,
  IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET,
  IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET,
  IMAGE_DEBUG_TYPE_CODEVIEW,
  IMAGE_DIRECTORY_ENTRY_DEBUG,
  IMAGE_DOS_SIGNATURE,
  IMAGE_FILE_MACHINE_AMD64,
  IMAGE_FILE_MACHINE_ARM32,
  IMAGE_FILE_MACHINE_ARM64,
  IMAGE_FILE_MACHINE_I386,
  IMAGE_NT_HEADERS32_SIZE,
  IMAGE_NT_HEADERS64_SIZE,
  IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_MAGIC_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET,
  IMAGE_NT_HEADERS_GENERIC_SIZE,
  IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET,
  IMAGE_NT_OPTIONAL_HDR64_MAGIC,
  IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET,
  IMAGE_SECTION_HEADER_SIZE,
  IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET,
  IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET,
  IMAGE_SHORT_NAME_SIZE,
  MachineArchitecture,
  PDB70_SIGNATURE,
} from './pe-constants'

export type GUID = {
  Data1: number // unsigned long (32-bit)
  Data2: number // unsigned short (16-bit)
  Data3: number // unsigned short (16-bit)

  // the 8 bytes array is stored as 4 x 2 bytes
  Data4: number // unsigned short (16-bit)
  Data4_1: number // unsigned short (16-bit)
  Data4_2: number // unsigned short (16-bit)
  Data4_3: number // unsigned short (16-bit)
}

export type PEHeader = {
  peHeaderOffset: number
  is64: boolean // false means 32 bit
  architecture: MachineArchitecture
  numberOfSections: number
  buildTime: string
  sectionHeadersOffset: number
}

export type PEFileMetadata = {
  filename: string
  isPE: boolean
  arch: MachineArchitecture
  hasPdbInfo: boolean
  pdbAge: number
  pdbSig: string | undefined
  error?: Error
}

export type PEResult = {
  isPE: boolean
  peHeader?: PEHeader
  error?: Error
}

const getArchitecture = (machine: number): MachineArchitecture => {
  let architecture: MachineArchitecture = MachineArchitecture.unknown

  if (machine === IMAGE_FILE_MACHINE_I386) {
    architecture = MachineArchitecture.x86
  } else if (machine === IMAGE_FILE_MACHINE_AMD64) {
    architecture = MachineArchitecture.x64
  } else if (machine === IMAGE_FILE_MACHINE_ARM32) {
    architecture = MachineArchitecture.Arm32
  } else if (machine === IMAGE_FILE_MACHINE_ARM64) {
    architecture = MachineArchitecture.Arm64
  }

  return architecture
}

const readPEHeader = async (reader: Reader): Promise<PEResult> => {
  const result: PEResult = {
    isPE: false,
  }
  result.peHeader = {
    peHeaderOffset: 0,
    is64: false,
    architecture: MachineArchitecture.unknown,
    numberOfSections: 0,
    buildTime: '',
    sectionHeadersOffset: 0,
  }

  try {
    // read the DOS header to find the offset to the PE header
    const dosHeaderBuffer = await reader.read(DOS_HEADER_SIZE)
    const dosMagic = dosHeaderBuffer.readInt16LE(0)
    if (dosMagic !== IMAGE_DOS_SIGNATURE) {
      result.isPE = false
      result.error = Error('Invalid DOS header')

      return result
    }

    const peHeaderOffset: number = dosHeaderBuffer.readUint32LE(DOS_HEADER_LFANEW_OFFSET)
    result.peHeader.peHeaderOffset = peHeaderOffset

    // look at the PE header now
    const peCommonHeaderBuffer = await reader.read(IMAGE_NT_HEADERS_GENERIC_SIZE, peHeaderOffset)

    // check the signature
    const peSignature = peCommonHeaderBuffer.toString('utf-8', 0, 4)
    if (peSignature !== 'PE\0\0') {
      result.isPE = false
      result.error = Error('Invalid PE header')

      return result
    }

    // read the Machine field
    const machine = peCommonHeaderBuffer.readUint16LE(IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET)
    result.peHeader.architecture = getArchitecture(machine)

    // read the NumberOfSections field
    result.peHeader.numberOfSections = peCommonHeaderBuffer.readUint16LE(
      IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET
    )

    // read the build time
    const timestamp = peCommonHeaderBuffer.readUint32LE(IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET)
    const buildDate = new Date(timestamp * 1000).toUTCString()
    result.peHeader.buildTime = `${buildDate}`

    // read the Magic field
    const magic = peCommonHeaderBuffer.readUint16LE(IMAGE_NT_HEADERS_GENERIC_MAGIC_OFFSET)
    result.peHeader.is64 = magic === IMAGE_NT_OPTIONAL_HDR64_MAGIC
    result.peHeader.sectionHeadersOffset = result.peHeader.is64 ? IMAGE_NT_HEADERS64_SIZE : IMAGE_NT_HEADERS32_SIZE
    result.isPE = true
  } catch (error) {
    // console.log(error)
    if (error instanceof Error) {
      result.error = error
    } else {
      throw error
    }
  }

  return result
}

type SectionHeader = {
  name: string
  virtualSize: number
  virtualAddress: number
  pointerToRawData: number
}

const getSectionHeaders = async (reader: Reader, peHeader: PEHeader): Promise<SectionHeader[]> => {
  const sections = new Array<SectionHeader>(peHeader.numberOfSections)
  const sectionHeadersOffset: number = peHeader.peHeaderOffset + peHeader.sectionHeadersOffset
  const sectionsBuffer = await reader.read(peHeader.numberOfSections * IMAGE_SECTION_HEADER_SIZE, sectionHeadersOffset)
  let sectionOffset = 0
  for (let i = 0; i < peHeader.numberOfSections; i++) {
    // the name is at the beginning of the section header
    let name = ''
    for (let j = 0; j < IMAGE_SHORT_NAME_SIZE; j++) {
      if (sectionsBuffer[sectionOffset + j] === 0) {
        break
      }
      name += String.fromCharCode(sectionsBuffer[sectionOffset + j])
    }
    const virtualSize: number = sectionsBuffer.readUInt32LE(sectionOffset + IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET)
    const virtualAddress: number = sectionsBuffer.readUInt32LE(
      sectionOffset + IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET
    )
    const pointerToRawData: number = sectionsBuffer.readUInt32LE(
      sectionOffset + IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET
    )
    sections[i] = {name, virtualSize, virtualAddress, pointerToRawData}

    sectionOffset += IMAGE_SECTION_HEADER_SIZE
  }

  return sections
}

// from https://github.com/microsoft/clrmd/blob/main/src/Microsoft.Diagnostics.Runtime/Utilities/PEImage/PEImage.cs#L286C1-L303C10
const rvaToOffset = (virtualAddress: number, sections: SectionHeader[]): number => {
  if (virtualAddress < 4096) {
    return virtualAddress
  }

  for (const section of sections) {
    if (section.virtualAddress <= virtualAddress && virtualAddress < section.virtualAddress + section.virtualSize) {
      const offset = section.pointerToRawData + (virtualAddress - section.virtualAddress)

      return offset
    }
  }

  return 0
}

const toHex = (value: number, length: number): string => {
  return value.toString(16).padStart(length, '0').toUpperCase()
}

export const getPEFileMetadata = async (filename: string): Promise<PEFileMetadata> => {
  const metadata: PEFileMetadata = {
    filename: '',
    isPE: false,
    arch: MachineArchitecture.unknown,
    hasPdbInfo: false,
    pdbAge: 0,
    pdbSig: undefined,
  }

  let fileHandle: fs.promises.FileHandle | undefined
  try {
    fileHandle = await fs.promises.open(filename, 'r')
    const reader = new FileReader(fileHandle)
    const peHeaderResult = await readPEHeader(reader)
    if (!peHeaderResult.isPE || peHeaderResult.peHeader === undefined) {
      throw peHeaderResult.error
    }
    metadata.isPE = true
    metadata.arch = peHeaderResult.peHeader?.architecture

    // get the DEBUG section
    let debugSectionOffset = 0
    if (peHeaderResult.peHeader.is64) {
      debugSectionOffset = peHeaderResult.peHeader.peHeaderOffset + IMAGE_DATA_DIRECTORY64_OFFSET
    } else {
      debugSectionOffset = peHeaderResult.peHeader.peHeaderOffset + IMAGE_DATA_DIRECTORY32_OFFSET
    }

    debugSectionOffset += IMAGE_DIRECTORY_ENTRY_DEBUG * IMAGE_DATA_DIRECTORY_SIZE
    const peCommonHeaderBuffer = await reader.read(IMAGE_DATA_DIRECTORY_SIZE, debugSectionOffset)
    const debugSectionVirtualAddress: number = peCommonHeaderBuffer.readUInt32LE(
      IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET
    )
    const debugSectionSize: number = peCommonHeaderBuffer.readUInt32LE(IMAGE_DATA_DIRECTORY_SIZE_OFFSET)
    if (debugSectionVirtualAddress === 0) {
      metadata.hasPdbInfo = false

      return metadata
    }

    // The "virtual address"  needs to be converted into an offset from the begining of the PE file (like peHeaderOffset).
    // To be able to do that, we need to load the array of IMAGE_SECTION_HEADER that follows the optional header;
    // their count is given by the IMAGE_SECTION_HEADER.NumberOfSections field
    const sectionHeaders = await getSectionHeaders(reader, peHeaderResult.peHeader)
    const debugDirectoriesOffset = rvaToOffset(debugSectionVirtualAddress, sectionHeaders)

    // look inside the different IMAGE_DEBUG_DIRECTORY
    const debugSectionBuffer = await reader.read(debugSectionSize, debugDirectoriesOffset)
    const entryCount: number = debugSectionSize / IMAGE_DEBUG_DIRECTORY_SIZE
    let entryOffset = 0
    for (let i = 0; i < entryCount; i++) {
      const type: number = debugSectionBuffer.readUInt32LE(entryOffset + IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET)
      if (type === IMAGE_DEBUG_TYPE_CODEVIEW) {
        const pdbInfoSizeOfData: number = debugSectionBuffer.readUInt32LE(
          entryOffset + IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET
        )
        const pdbInfoAddress: number = debugSectionBuffer.readUInt32LE(
          entryOffset + IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET
        )
        const pdbInfoOffset: number = rvaToOffset(pdbInfoAddress, sectionHeaders)
        // we are insterested in the .pdb filename that goes beyond the CV_INFO_PDB70 structure
        const pdbInfoBuffer = await reader.read(pdbInfoSizeOfData, pdbInfoOffset)
        const pdbSignature: number = pdbInfoBuffer.readUInt32LE(CV_INFO_SIGNATURE_OFFSET)
        if (pdbSignature === PDB70_SIGNATURE) {
          metadata.hasPdbInfo = true
          metadata.pdbAge = pdbInfoBuffer.readUInt32LE(CV_INFO_AGE_OFFSET)

          // read the GUID that spans 16 bytes and save it as
          // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
          metadata.pdbSig =
            toHex(pdbInfoBuffer.readUInt32LE(CV_INFO_GUID_OFFSET), 8) +
            '-' +
            toHex(pdbInfoBuffer.readUInt16LE(CV_INFO_GUID_OFFSET + 4), 4) +
            '-' +
            toHex(pdbInfoBuffer.readUInt16LE(CV_INFO_GUID_OFFSET + 6), 4) +
            '-' +
            toHex(pdbInfoBuffer.readUInt16BE(CV_INFO_GUID_OFFSET + 8), 4) +
            '-' +
            toHex(pdbInfoBuffer.readUInt16BE(CV_INFO_GUID_OFFSET + 10), 4) +
            toHex(pdbInfoBuffer.readUInt16BE(CV_INFO_GUID_OFFSET + 12), 4) +
            toHex(pdbInfoBuffer.readUInt16BE(CV_INFO_GUID_OFFSET + 14), 4)

          // read .pdb filename that follows in the structure
          // --> read the characters up to pdbInfoSizeOfData
          // this is not working maybe due to the \ that are replaced by \\
          // const pdbFilename = pdbInfoBuffer.toString('utf-8', CV_INFO_PDB_FILENAME_OFFSET, pdbInfoSizeOfData - CV_INFO_PDB_FILENAME_OFFSET + 1)
          let pdbFilename = ''
          for (let j = CV_INFO_PDB_FILENAME_OFFSET; j < pdbInfoSizeOfData; j++) {
            if (pdbInfoBuffer[j] === 0) {
              break
            }
            pdbFilename += String.fromCharCode(pdbInfoBuffer[j])
          }
          metadata.filename = pdbFilename
        } else {
          metadata.hasPdbInfo = false
        }

        return metadata
      }

      entryOffset += IMAGE_DEBUG_DIRECTORY_SIZE
    }
  } catch (error) {
    // console.log(error)
    if (error instanceof Error) {
      metadata.error = error
    } else {
      throw error
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close()
    }
  }

  return metadata
}

export const getBuildId = (fileMetadata: PEFileMetadata): string => {
  if (fileMetadata.isPE && fileMetadata.hasPdbInfo) {
    return `${fileMetadata.pdbSig}_${fileMetadata.pdbAge}`
  }

  return '?_?'
}
