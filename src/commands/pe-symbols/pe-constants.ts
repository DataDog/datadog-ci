/*
typedef struct _IMAGE_DOS_HEADER {      // DOS .EXE header
   0    WORD   e_magic;                     // Magic number
        WORD   e_cblp;                      // Bytes on last page of file
        WORD   e_cp;                        // Pages in file
        WORD   e_crlc;                      // Relocations
        WORD   e_cparhdr;                   // Size of header in paragraphs
        WORD   e_minalloc;                  // Minimum extra paragraphs needed
        WORD   e_maxalloc;                  // Maximum extra paragraphs needed
        WORD   e_ss;                        // Initial (relative) SS value
        WORD   e_sp;                        // Initial SP value
        WORD   e_csum;                      // Checksum
        WORD   e_ip;                        // Initial IP value
        WORD   e_cs;                        // Initial (relative) CS value
        WORD   e_lfarlc;                    // File address of relocation table
        WORD   e_ovno;                      // Overlay number
        WORD   e_res[4];                    // Reserved words
        WORD   e_oemid;                     // OEM identifier (for e_oeminfo)
        WORD   e_oeminfo;                   // OEM information; e_oemid specific
        WORD   e_res2[10];                  // Reserved words
  60    LONG   e_lfanew;                    // File address of new exe header
  } IMAGE_DOS_HEADER, *PIMAGE_DOS_HEADER;
*/
export const DOS_HEADER_SIZE = 64
export const IMAGE_DOS_SIGNATURE = 0x5a4d // MZ
export const DOS_HEADER_LFANEW_OFFSET = 0x3c // = 60 bytes - offset to read e_lfanew in DOS header
export type DOSHeader = {
  e_magic: number
  e_lfanew: number // offset to the PE header
}

/*
// PE32 and PE64 have different optional headers, which complexify the logic to fetch them
// This struct contains the common fields between the two types of headers
struct IMAGE_NT_HEADERS_GENERIC
{
   0    DWORD               Signature;
        IMAGE_FILE_HEADER   FileHeader;
   4        WORD    Machine;
   6        WORD    NumberOfSections;
   8        DWORD   TimeDateStamp;
            DWORD   PointerToSymbolTable;
            DWORD   NumberOfSymbols;
            WORD    SizeOfOptionalHeader;
            WORD    Characteristics;
  24    WORD                Magic;  // common between 32 bit and 64 bit structures
};
*/
export const IMAGE_NT_HEADERS_GENERIC_SIZE = 26

// Signature field is at the beginning of the common PR header
// export const IMAGE_NT_SIGNATURE: number = 0x00004550;  // PE00 at the start of the structure
// export const IMAGE_NT_HEADERS_GENERIC_SIGNATURE_OFFSET = 0;  // looking Signature field

// Machine field
export const IMAGE_NT_HEADERS_GENERIC_MACHINE_OFFSET = 4 // looking for Machine field
export const IMAGE_FILE_MACHINE_I386 = 0x014c // 32 bit
export const IMAGE_FILE_MACHINE_AMD64 = 0x8664 // 64 bit
export const IMAGE_FILE_MACHINE_ARM32 = 0x01c0 // 32 bit
export const IMAGE_FILE_MACHINE_ARM64 = 0xaa64 // 64 bit
export enum MachineArchitecture {
  unknown = 0,
  x86 = 1,
  x64 = 2,
  Arm32 = 3,
  Arm64 = 4,
}

// NumberOfSections field
export const IMAGE_NT_HEADERS_GENERIC_NUMBEROFSECTIONS_OFFSET = 6

// Timestamp field
export const IMAGE_NT_HEADERS_GENERIC_TIMESTAMP_OFFSET = 8 // looking for Timestamp field

// // SizeOfOptionalHeader field
// export const IMAGE_NT_HEADERS_GENERIC_SIZEOFOPTIONALHEADER_OFFSET: number = 20;

// Magic field
export const IMAGE_NT_HEADERS_GENERIC_MAGIC_OFFSET = 24 // looking for 32/64 bit info
export const IMAGE_NT_OPTIONAL_HDR32_MAGIC = 0x10b
export const IMAGE_NT_OPTIONAL_HDR64_MAGIC = 0x20b

// the offset to the 16 sections (including the DEBUG one - the IMAGE_DIRECTORY_ENTRY_DEBUG entry in the array)
// are at the end of the IMAGE_OPTIONAL_HEADERxx structure whose content is different between 32 and 64 bit
// the DEBUG section contains the address to the debug metadata
export const IMAGE_NUMBEROF_DIRECTORY_ENTRIES = 16
export const IMAGE_DATA_DIRECTORY_SIZE = 8 // DWORD + DWORD
export const IMAGE_DIRECTORY_ENTRY_DEBUG = 6 // --> 6 entries before this one
export const IMAGE_NT_HEADERS32_SIZE = 248
export const IMAGE_DATA_DIRECTORY32_OFFSET: number =
  IMAGE_NT_HEADERS32_SIZE - IMAGE_NUMBEROF_DIRECTORY_ENTRIES * IMAGE_DATA_DIRECTORY_SIZE
export const IMAGE_NT_HEADERS64_SIZE = 264
export const IMAGE_DATA_DIRECTORY64_OFFSET: number =
  IMAGE_NT_HEADERS64_SIZE - IMAGE_NUMBEROF_DIRECTORY_ENTRIES * IMAGE_DATA_DIRECTORY_SIZE

// in the DEBUG directory, we need to find the Virtual Address field and the size of the section
/*
typedef struct _IMAGE_DATA_DIRECTORY {
   0    DWORD   VirtualAddress;
   4    DWORD   Size;
} IMAGE_DATA_DIRECTORY, *PIMAGE_DATA_DIRECTORY;
 */
export const IMAGE_DATA_DIRECTORY_VIRTUAL_ADDRESS_OFFSET = 0
export const IMAGE_DATA_DIRECTORY_SIZE_OFFSET = 4

// !!! don't forget that VirtualAddress needs to be transformed into an offset from the beginning of the file !!!
// this code uses the table of sections header within the PE file that appear AFTER the array of IMAGE_DATA_DIRECTORY
// i.e. at IMAGE_NT_HEADERS32_SIZE or IMAGE_NT_HEADERS64_SIZE after the beginning of the PE header
/*
#define IMAGE_SIZEOF_SHORT_NAME 8

typedef struct _IMAGE_SECTION_HEADER {
    0   BYTE    Name[IMAGE_SIZEOF_SHORT_NAME];
        union {
    8       DWORD   PhysicalAddress;
            DWORD   VirtualSize;
        } Misc;
   12   DWORD   VirtualAddress;
        DWORD   SizeOfRawData;
   20   DWORD   PointerToRawData;
        DWORD   PointerToRelocations;
        DWORD   PointerToLinenumbers;
        WORD    NumberOfRelocations;
        WORD    NumberOfLinenumbers;
        DWORD   Characteristics;
} IMAGE_SECTION_HEADER, *PIMAGE_SECTION_HEADER;

#define IMAGE_SIZEOF_SECTION_HEADER 40
*/
export const IMAGE_SHORT_NAME_SIZE = 8
export const IMAGE_SECTION_HEADER_SIZE = 40
export const IMAGE_SECTION_HEADER_VIRTUALSIZE_OFFSET = 8
export const IMAGE_SECTION_HEADER_VIRTUALADDRESS_OFFSET = 12
export const IMAGE_SECTION_HEADER_POINTERTORAWDATA_OFFSET = 20

// once we've tranformed this "virtual address" into an offset, it points to an array of IMAGE_DEBUG_DIRECTORY
/*
typedef struct _IMAGE_DEBUG_DIRECTORY {
        DWORD   Characteristics;
   4    DWORD   TimeDateStamp;
        WORD    MajorVersion;
        WORD    MinorVersion;
  12    DWORD   Type;
  16    DWORD   SizeOfData;
  20    DWORD   AddressOfRawData;
  24    DWORD   PointerToRawData;
} IMAGE_DEBUG_DIRECTORY, *PIMAGE_DEBUG_DIRECTORY;

#define IMAGE_DEBUG_TYPE_CODEVIEW 2
*/
export const IMAGE_DEBUG_TYPE_CODEVIEW = 2
export const IMAGE_DEBUG_DIRECTORY_SIZE = 28
export const IMAGE_DEBUG_DIRECTORY_TYPE_OFFSET = 12
export const IMAGE_DEBUG_DIRECTORY_SIZEOFDATA_OFFSET = 16
export const IMAGE_DEBUG_DIRECTORY_ADDRESSOFRAWDATA_OFFSET = 20
export const IMAGE_DEBUG_DIRECTORY_POINTERTORAWDATA_OFFSET = 24

// the next step is to follow the raw data pointer to
/*
struct CV_INFO_PDB70
{
   0    DWORD Signature;
   4    GUID Guid;
  20    DWORD Age;
  24    char PdbFileName[];
};
*/
export const CV_INFO_PDB70_SIZE = 24 // followed by an array of char for the .pdb name
export const PDB70_SIGNATURE = 0x53445352 // "SDSR"
export const CV_INFO_SIGNATURE_OFFSET = 0
export const CV_INFO_GUID_OFFSET = 4
export const CV_INFO_AGE_OFFSET = 20
export const CV_INFO_PDB_FILENAME_OFFSET = 24
