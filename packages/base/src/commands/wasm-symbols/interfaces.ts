export const TYPE_WASM_DEBUG_INFOS = 'wasm'
export const VALUE_NAME_WASM_DEBUG_INFOS = 'wasm_symbol_file'
export const WASM_DEBUG_INFOS_FILENAME = 'wasm_symbol_file'

export interface MappingMetadata {
  cli_version: string
  origin_version: string

  arch: string
  origin: string
  git_commit_sha?: string
  git_repository_url?: string
  // Toolchain-provided `build_id` custom section, or a SHA-256-of-code-section fallback when absent.
  build_id: string
  file_hash: string
  symbol_source: string
  filename: string
  type: string
  overwrite: boolean
  // URL the module is served from, for engines (e.g. `instantiateStreaming`) that key lookups by URL.
  source_url?: string
}
