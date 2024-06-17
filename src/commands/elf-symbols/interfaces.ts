export const TYPE_ELF_DEBUG_INFOS = 'elf_symbol_file'
export const VALUE_NAME_ELF_DEBUG_INFOS = 'elf_symbol_file'
export const ELF_DEBUG_INFOS_FILENAME = 'elf_symbol_file'

export interface MappingMetadata {
  arch: string
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  platform?: string
  gnu_build_id: string
  go_build_id: string
  file_hash: string
  symbol_source: string
  type: string
}
