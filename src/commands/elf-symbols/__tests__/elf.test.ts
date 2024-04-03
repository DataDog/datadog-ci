import {createUniqueTmpDirectory, deleteDirectory} from '../../dsyms/utils'

import {
  copyElfDebugInfo,
  createReaderFromFile,
  getElfFileMetadata,
  getOutputFilenameFromBuildId,
  readElfHeader,
  readElfSectionHeaderTable,
  isSupportedArch,
  isSupportedElfType,
  readElfProgramHeaderTable,
  getBuildId,
} from '../elf'
import {MachineType, ElfFileType, ElfClass, SectionHeaderType, ProgramHeaderType} from '../elf-constants'

const fixtureDir = './src/commands/elf-symbols/__tests__/fixtures'

describe('elf', () => {
  describe('readElfHeader', () => {
    const getElfHeader = async (filename: string) => {
      const reader = await createReaderFromFile(filename)
      const elfResult = await readElfHeader(reader)

      return elfResult
    }

    test('throw an error if file does not exist', async () => {
      await expect(getElfHeader(`${fixtureDir}/non_existing_file`)).rejects.toThrow()
    })

    test('return false if file is not an ELF file', async () => {
      const result = await getElfHeader(`${fixtureDir}/non_elf_file`)
      expect(result.isElf).toBeFalsy()
      expect(result.error).toBeUndefined()
      expect(result.elfHeader).toBeUndefined()
    })

    test('return correct header if file is a DYN ELF aarch64 file', async () => {
      const result = await getElfHeader(`${fixtureDir}/dyn_aarch64`)
      expect(result.isElf).toBeTruthy()
      expect(result.error).toBeUndefined()
      expect(result.elfHeader).toBeDefined()
      expect(result.elfHeader).toEqual({
        abi: 0,
        abiVersion: 0,
        data: 1,
        elfClass: ElfClass.ELFCLASS64,
        elfVersion: 1,
        littleEndian: true,
        e_type: ElfFileType.ET_DYN,
        e_machine: MachineType.EM_AARCH64,
        e_version: 1,
        e_entry: BigInt(0),
        e_phoff: BigInt(64),
        e_shoff: BigInt(6896),
        e_flags: 0,
        e_ehsize: 64,
        e_phentsize: 56,
        e_phnum: 7,
        e_shentsize: 64,
        e_shnum: 30,
        e_shstrndx: 29,
      })
    })

    test('return correct header if file is a EXEC ELF aarch64 file', async () => {
      const result = await getElfHeader(`${fixtureDir}/exec_aarch64`)
      expect(result.isElf).toBeTruthy()
      expect(result.error).toBeUndefined()
      expect(result.elfHeader).toBeDefined()
      expect(result.elfHeader).toEqual({
        abi: 0,
        abiVersion: 0,
        data: 1,
        elfClass: ElfClass.ELFCLASS64,
        elfVersion: 1,
        littleEndian: true,
        e_type: ElfFileType.ET_EXEC,
        e_machine: MachineType.EM_AARCH64,
        e_version: 1,
        e_entry: BigInt(0x400480),
        e_phoff: BigInt(64),
        e_shoff: BigInt(7704),
        e_flags: 0,
        e_ehsize: 64,
        e_phentsize: 56,
        e_phnum: 9,
        e_shentsize: 64,
        e_shnum: 35,
        e_shstrndx: 34,
      })
    })

    test('return correct header if file is a DYN ELF x86_64 file', async () => {
      const result = await getElfHeader(`${fixtureDir}/go_x86_64_only_go_build_id`)
      expect(result.isElf).toBeTruthy()
      expect(result.error).toBeUndefined()
      expect(result.elfHeader).toBeDefined()
      expect(result.elfHeader).toEqual({
        abi: 0,
        abiVersion: 0,
        data: 1,
        elfClass: ElfClass.ELFCLASS64,
        elfVersion: 1,
        littleEndian: true,
        e_type: ElfFileType.ET_DYN,
        e_machine: MachineType.EM_X86_64,
        e_version: 1,
        e_entry: BigInt(0x1060),
        e_phoff: BigInt(64),
        e_shoff: BigInt(13584),
        e_flags: 0,
        e_ehsize: 64,
        e_phentsize: 56,
        e_phnum: 10,
        e_shentsize: 64,
        e_shnum: 30,
        e_shstrndx: 29,
      })
    })
  })

  describe('readElfSectionHeaderTable', () => {
    test('return section header table for ELF file', async () => {
      const reader = await createReaderFromFile(`${fixtureDir}/dyn_aarch64`)
      const elfResult = await readElfHeader(reader)
      const sectionHeaders = await readElfSectionHeaderTable(reader, elfResult.elfHeader!)

      expect(sectionHeaders).toEqual([
        {
          name: '',
          sh_name: 0,
          sh_type: SectionHeaderType.SHT_NULL,
          sh_flags: BigInt(0),
          sh_addr: BigInt(0),
          sh_offset: BigInt(0),
          sh_size: BigInt(0),
          sh_link: 0,
          sh_info: 0,
          sh_addralign: BigInt(0),
          sh_entsize: BigInt(0),
        },
        {
          name: '.note.gnu.build-id',
          sh_name: 27,
          sh_type: SectionHeaderType.SHT_NOTE,
          sh_flags: BigInt(2),
          sh_addr: BigInt(0x1c8),
          sh_offset: BigInt(0x1c8),
          sh_size: BigInt(0x24),
          sh_link: 0,
          sh_info: 0,
          sh_addralign: BigInt(0x4),
          sh_entsize: BigInt(0),
        },
        {
          name: '.gnu.hash',
          sh_addr: BigInt(496),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(2),
          sh_info: 0,
          sh_link: 3,
          sh_name: 46,
          sh_offset: BigInt(496),
          sh_size: BigInt(36),
          sh_type: SectionHeaderType.SHT_GNU_HASH,
        },
        {
          name: '.dynsym',
          sh_addr: BigInt(536),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(24),
          sh_flags: BigInt(2),
          sh_info: 3,
          sh_link: 4,
          sh_name: 56,
          sh_offset: BigInt(536),
          sh_size: BigInt(192),
          sh_type: SectionHeaderType.SHT_DYNSYM,
        },
        {
          name: '.dynstr',
          sh_addr: BigInt(728),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(2),
          sh_info: 0,
          sh_link: 0,
          sh_name: 64,
          sh_offset: BigInt(728),
          sh_size: BigInt(90),
          sh_type: SectionHeaderType.SHT_STRTAB,
        },
        {
          name: '.rela.dyn',
          sh_addr: BigInt(824),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(24),
          sh_flags: BigInt(2),
          sh_info: 0,
          sh_link: 3,
          sh_name: 72,
          sh_offset: BigInt(824),
          sh_size: BigInt(168),
          sh_type: SectionHeaderType.SHT_RELA,
        },
        {
          name: '.rela.plt',
          sh_addr: BigInt(992),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(24),
          sh_flags: BigInt(66),
          sh_info: 17,
          sh_link: 3,
          sh_name: 82,
          sh_offset: BigInt(992),
          sh_size: BigInt(48),
          sh_type: SectionHeaderType.SHT_RELA,
        },
        {
          name: '.init',
          sh_addr: BigInt(1040),
          sh_addralign: BigInt(4),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(6),
          sh_info: 0,
          sh_link: 0,
          sh_name: 92,
          sh_offset: BigInt(1040),
          sh_size: BigInt(24),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.plt',
          sh_addr: BigInt(1072),
          sh_addralign: BigInt(16),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(6),
          sh_info: 0,
          sh_link: 0,
          sh_name: 87,
          sh_offset: BigInt(1072),
          sh_size: BigInt(64),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.text',
          sh_addr: BigInt(1136),
          sh_addralign: BigInt(16),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(6),
          sh_info: 0,
          sh_link: 0,
          sh_name: 98,
          sh_offset: BigInt(1136),
          sh_size: BigInt(236),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.fini',
          sh_addr: BigInt(1372),
          sh_addralign: BigInt(4),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(6),
          sh_info: 0,
          sh_link: 0,
          sh_name: 104,
          sh_offset: BigInt(1372),
          sh_size: BigInt(20),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.eh_frame_hdr',
          sh_addr: BigInt(1392),
          sh_addralign: BigInt(4),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(2),
          sh_info: 0,
          sh_link: 0,
          sh_name: 110,
          sh_offset: BigInt(1392),
          sh_size: BigInt(52),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.eh_frame',
          sh_addr: BigInt(1448),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(2),
          sh_info: 0,
          sh_link: 0,
          sh_name: 124,
          sh_offset: BigInt(1448),
          sh_size: BigInt(144),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.init_array',
          sh_addr: BigInt(69168),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(8),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 134,
          sh_offset: BigInt(3632),
          sh_size: BigInt(8),
          sh_type: SectionHeaderType.SHT_INIT_ARRAY,
        },
        {
          name: '.fini_array',
          sh_addr: BigInt(69176),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(8),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 146,
          sh_offset: BigInt(3640),
          sh_size: BigInt(8),
          sh_type: SectionHeaderType.SHT_FINI_ARRAY,
        },
        {
          name: '.dynamic',
          sh_addr: BigInt(69184),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(16),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 4,
          sh_name: 158,
          sh_offset: BigInt(3648),
          sh_size: BigInt(384),
          sh_type: SectionHeaderType.SHT_DYNAMIC,
        },
        {
          name: '.got',
          sh_addr: BigInt(69568),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(8),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 167,
          sh_offset: BigInt(4032),
          sh_size: BigInt(40),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.got.plt',
          sh_addr: BigInt(69608),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(8),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 172,
          sh_offset: BigInt(4072),
          sh_size: BigInt(40),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.data',
          sh_addr: BigInt(69648),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 181,
          sh_offset: BigInt(4112),
          sh_size: BigInt(8),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.bss',
          sh_addr: BigInt(69656),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(3),
          sh_info: 0,
          sh_link: 0,
          sh_name: 187,
          sh_offset: BigInt(4120),
          sh_size: BigInt(8),
          sh_type: SectionHeaderType.SHT_NOBITS,
        },
        {
          name: '.comment',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(1),
          sh_flags: BigInt(48),
          sh_info: 0,
          sh_link: 0,
          sh_name: 192,
          sh_offset: BigInt(4120),
          sh_size: BigInt(43),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_aranges',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 201,
          sh_offset: BigInt(4163),
          sh_size: BigInt(48),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_info',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 216,
          sh_offset: BigInt(4211),
          sh_size: BigInt(84),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_abbrev',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 228,
          sh_offset: BigInt(4295),
          sh_size: BigInt(56),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_line',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 242,
          sh_offset: BigInt(4351),
          sh_size: BigInt(76),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_str',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(1),
          sh_flags: BigInt(48),
          sh_info: 0,
          sh_link: 0,
          sh_name: 254,
          sh_offset: BigInt(4427),
          sh_size: BigInt(135),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.debug_line_str',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(1),
          sh_flags: BigInt(48),
          sh_info: 0,
          sh_link: 0,
          sh_name: 265,
          sh_offset: BigInt(4562),
          sh_size: BigInt(11),
          sh_type: SectionHeaderType.SHT_PROGBITS,
        },
        {
          name: '.symtab',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(8),
          sh_entsize: BigInt(24),
          sh_flags: BigInt(0),
          sh_info: 64,
          sh_link: 28,
          sh_name: 1,
          sh_offset: BigInt(4576),
          sh_size: BigInt(1656),
          sh_type: SectionHeaderType.SHT_SYMTAB,
        },
        {
          name: '.strtab',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 9,
          sh_offset: BigInt(6232),
          sh_size: BigInt(378),
          sh_type: SectionHeaderType.SHT_STRTAB,
        },
        {
          name: '.shstrtab',
          sh_addr: BigInt(0),
          sh_addralign: BigInt(1),
          sh_entsize: BigInt(0),
          sh_flags: BigInt(0),
          sh_info: 0,
          sh_link: 0,
          sh_name: 17,
          sh_offset: BigInt(6610),
          sh_size: BigInt(281),
          sh_type: SectionHeaderType.SHT_STRTAB,
        },
      ])
    })
  })

  describe('readElfProgranHeaderTable', () => {
    test('return program header table for ELF file', async () => {
      const reader = await createReaderFromFile(`${fixtureDir}/dyn_aarch64`)
      const elfResult = await readElfHeader(reader)
      const programHeaders = await readElfProgramHeaderTable(reader, elfResult.elfHeader!)

      expect(programHeaders).toEqual([
        {
          p_align: BigInt(65536),
          p_filesz: BigInt(1592),
          p_flags: 5,
          p_memsz: BigInt(1592),
          p_offset: BigInt(0),
          p_paddr: BigInt(0),
          p_type: ProgramHeaderType.PT_LOAD,
          p_vaddr: BigInt(0),
        },
        {
          p_align: BigInt(65536),
          p_filesz: BigInt(488),
          p_flags: 6,
          p_memsz: BigInt(496),
          p_offset: BigInt(3632),
          p_paddr: BigInt(69168),
          p_type: ProgramHeaderType.PT_LOAD,
          p_vaddr: BigInt(69168),
        },
        {
          p_align: BigInt(8),
          p_filesz: BigInt(384),
          p_flags: 6,
          p_memsz: BigInt(384),
          p_offset: BigInt(3648),
          p_paddr: BigInt(69184),
          p_type: ProgramHeaderType.PT_DYNAMIC,
          p_vaddr: BigInt(69184),
        },
        {
          p_align: BigInt(4),
          p_filesz: BigInt(36),
          p_flags: 4,
          p_memsz: BigInt(36),
          p_offset: BigInt(456),
          p_paddr: BigInt(456),
          p_type: ProgramHeaderType.PT_NOTE,
          p_vaddr: BigInt(456),
        },
        {
          p_align: BigInt(4),
          p_filesz: BigInt(52),
          p_flags: 4,
          p_memsz: BigInt(52),
          p_offset: BigInt(1392),
          p_paddr: BigInt(1392),
          p_type: ProgramHeaderType.PT_GNU_EH_FRAME,
          p_vaddr: BigInt(1392),
        },
        {
          p_align: BigInt(16),
          p_filesz: BigInt(0),
          p_flags: 6,
          p_memsz: BigInt(0),
          p_offset: BigInt(0),
          p_paddr: BigInt(0),
          p_type: ProgramHeaderType.PT_GNU_STACK,
          p_vaddr: BigInt(0),
        },
        {
          p_align: BigInt(1),
          p_filesz: BigInt(464),
          p_flags: 4,
          p_memsz: BigInt(464),
          p_offset: BigInt(3632),
          p_paddr: BigInt(69168),
          p_type: ProgramHeaderType.PT_GNU_RELRO,
          p_vaddr: BigInt(69168),
        },
      ])
    })
  })

  describe('isSupportedArch', () => {
    test('return true for supported arch', () => {
      expect(isSupportedArch('aarch64')).toBeTruthy()
      expect(isSupportedArch('x86_64')).toBeTruthy()
    })
    test('return false for unsupported arch', () => {
      expect(isSupportedArch('arm')).toBeFalsy()
    })
  })

  describe('isSupportedElfType', () => {
    test('return true for supported type', () => {
      expect(isSupportedElfType('DYN')).toBeTruthy()
      expect(isSupportedElfType('EXEC')).toBeTruthy()
    })
    test('return false for unsupported type', () => {
      expect(isSupportedElfType('REL')).toBeFalsy()
    })
  })

  describe('getBuildId', () => {
    test('return GNU build id from ELF file', async () => {
      const reader = await createReaderFromFile(`${fixtureDir}/dyn_aarch64`)
      const {elfHeader} = await readElfHeader(reader)
      const sectionHeaders = await readElfSectionHeaderTable(reader, elfHeader!)
      const buildId = await getBuildId(reader, sectionHeaders, elfHeader!)

      expect(buildId).toEqual('90aef8b4a3cd45d758501e49d1d9844736c872cd')
    })

    test('return Go build id from ELF file', async () => {
      const reader = await createReaderFromFile(`${fixtureDir}/go_x86_64_only_go_build_id`)
      const {elfHeader} = await readElfHeader(reader)
      const sectionHeaders = await readElfSectionHeaderTable(reader, elfHeader!)
      const buildId = await getBuildId(reader, sectionHeaders, elfHeader!)

      expect(buildId).toEqual('tUhrGOwxi48kXlLhYlY3/WlmPekR2qonrFvofssLt/8beXJbt0rDaHhn3I6x8D/IA6Zd8Qc8Rsh_bFKoPVn')
    })
  })

  describe('getElfFileMetadata', () => {
    test('return error if file does not exist', async () => {
      const metadata = await getElfFileMetadata(`${fixtureDir}/non_existing_file`)
      expect(metadata.error).toBeTruthy()
    })

    test('return error if elf file is truncated', async () => {
      const metadata = await getElfFileMetadata(`${fixtureDir}/truncated_elf_file`)
      expect(metadata.error).toBeTruthy()
    })

    test('return metadata for ELF file', async () => {
      expect(await getElfFileMetadata(`${fixtureDir}/dyn_aarch64`)).toEqual({
        filename: `${fixtureDir}/dyn_aarch64`,
        isElf: true,
        arch: 'aarch64',
        buildId: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
        type: 'DYN',
        hasDebugInfo: true,
        hasSymbols: true,
        hasCode: true,
      })

      expect(await getElfFileMetadata(`${fixtureDir}/dyn_aarch64.debug`)).toEqual({
        filename: `${fixtureDir}/dyn_aarch64.debug`,
        isElf: true,
        arch: 'aarch64',
        buildId: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
        type: 'DYN',
        hasDebugInfo: true,
        hasSymbols: true,
        hasCode: false,
      })

      expect(await getElfFileMetadata(`${fixtureDir}/dyn_aarch64_nobuildid`)).toEqual({
        filename: `${fixtureDir}/dyn_aarch64_nobuildid`,
        isElf: true,
        arch: 'aarch64',
        buildId: '',
        type: 'DYN',
        hasDebugInfo: true,
        hasSymbols: true,
        hasCode: true,
      })

      expect(await getElfFileMetadata(`${fixtureDir}/go_x86_64_both_gnu_and_go_build_id`)).toEqual({
        filename: `${fixtureDir}/go_x86_64_both_gnu_and_go_build_id`,
        isElf: true,
        arch: 'x86_64',
        buildId: '6a5e565db576fe96acd8ab12bf857eb36f8afdf4',
        type: 'DYN',
        hasDebugInfo: false,
        hasSymbols: false,
        hasCode: true,
      })

      expect(await getElfFileMetadata(`${fixtureDir}/go_x86_64_only_go_build_id`)).toEqual({
        filename: `${fixtureDir}/go_x86_64_only_go_build_id`,
        isElf: true,
        arch: 'x86_64',
        buildId: 'tUhrGOwxi48kXlLhYlY3/WlmPekR2qonrFvofssLt/8beXJbt0rDaHhn3I6x8D/IA6Zd8Qc8Rsh_bFKoPVn',
        type: 'DYN',
        hasDebugInfo: false,
        hasSymbols: false,
        hasCode: true,
      })
    })
  })

  describe('getOutputFilenameFromBuildId', () => {
    test('return filename from build id', () => {
      expect(getOutputFilenameFromBuildId('90aef8b4a3cd45d758501e49d1d9844736c872cd')).toEqual(
        '90aef8b4a3cd45d758501e49d1d9844736c872cd'
      )
      expect(
        getOutputFilenameFromBuildId(
          'tUhrGOwxi48kXlLhYlY3/WlmPekR2qonrFvofssLt/8beXJbt0rDaHhn3I6x8D/IA6Zd8Qc8Rsh_bFKoPVn'
        )
      ).toEqual('tUhrGOwxi48kXlLhYlY3-WlmPekR2qonrFvofssLt-8beXJbt0rDaHhn3I6x8D-IA6Zd8Qc8Rsh_bFKoPVn')
    })
  })

  describe('copyElfDebugInfo', () => {
    let tmpDirectory: string

    beforeAll(async () => {
      tmpDirectory = await createUniqueTmpDirectory()
    })

    const checkCopyDebugInfo = async (elfFile: string, arch: string) => {
      const outputFilename = `${tmpDirectory}/output.debug`
      await copyElfDebugInfo(elfFile, outputFilename, arch, false)
      const elfFileMetadata = await getElfFileMetadata(elfFile)
      const debugInfoMetadata = await getElfFileMetadata(outputFilename)

      // check that elf and debug info metadata are equal except for hasCode and filename
      expect(debugInfoMetadata).toEqual({...elfFileMetadata, hasCode: false, filename: outputFilename})
    }

    test('copy debug info from aarch64 elf file', async () => {
      const testFiles = [
        {filename: 'dyn_aarch64', arch: 'aarch64'},
        {filename: 'exec_aarch64', arch: 'aarch64'},
        {filename: 'dyn_aarch64.debug', arch: 'aarch64'},
        {filename: 'go_x86_64_only_go_build_id', arch: 'x86_64'},
        {filename: 'go_x86_64_only_go_build_id.debug', arch: 'x86_64'},
      ]

      for (const testFile of testFiles) {
        await checkCopyDebugInfo(`${fixtureDir}/${testFile.filename}`, testFile.arch)
      }
    })

    afterAll(async () => {
      await deleteDirectory(tmpDirectory)
    })
  })
})
