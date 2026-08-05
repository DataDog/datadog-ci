export const TYPE_WASM_DEBUG_INFOS = 'wasm_symbol_file'
export const VALUE_NAME_WASM_DEBUG_INFOS = 'wasm_symbol_file'
export const WASM_DEBUG_INFOS_FILENAME = 'wasm_symbol_file'

export interface MappingMetadata {
  cli_version: string
  origin_version: string

  origin: string
  git_commit_sha?: string
  git_repository_url?: string
  // Toolchain-provided `build_id` custom section.
  build_id: string
  symbol_source: string
  filename: string
  type: string
  overwrite: boolean
}
