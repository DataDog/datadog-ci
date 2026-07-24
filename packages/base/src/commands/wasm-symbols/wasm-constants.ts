// WASM binary format constants.
// https://webassembly.github.io/spec/core/binary/modules.html

export const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d])
export const WASM_VERSION = Buffer.from([0x01, 0x00, 0x00, 0x00])

export enum WasmSectionId {
  CUSTOM = 0,
  TYPE = 1,
  IMPORT = 2,
  FUNCTION = 3,
  TABLE = 4,
  MEMORY = 5,
  GLOBAL = 6,
  EXPORT = 7,
  START = 8,
  ELEMENT = 9,
  CODE = 10,
  DATA = 11,
  DATA_COUNT = 12,
}

// Custom section carrying a toolchain-provided build id, analogous to ELF's `.note.gnu.build-id`.
// Not standardized by the WASM spec: this is the name datadog tooling and the Datadog Browser SDK
// agree on for identifying a module's symbol file.
export const WASM_BUILD_ID_SECTION_NAME = 'build_id'

// Custom section pointing at an external debug file, analogous to ELF's `.gnu_debuglink`.
export const WASM_EXTERNAL_DEBUG_INFO_SECTION_NAME = 'external_debug_info'

// DWARF debug sections are embedded as custom sections using the same names as in ELF/Mach-O.
export const WASM_DEBUG_SECTION_PREFIX = '.debug_'

export const SUPPORTED_WASM_ARCHS = ['wasm32', 'wasm64'] as const
export type WasmArch = (typeof SUPPORTED_WASM_ARCHS)[number]
export const DEFAULT_WASM_ARCH: WasmArch = 'wasm32'

export const isSupportedWasmArch = (arch: string): arch is WasmArch =>
  (SUPPORTED_WASM_ARCHS as readonly string[]).includes(arch)
