export const TYPE_ELF_DEBUG_INFOS = 'elf_symbol_file'
export const VALUE_NAME_ELF_DEBUG_INFOS = 'elf_symbol_file'
export const ELF_DEBUG_INFOS_FILENAME = 'elf_symbol_file'

export interface MappingMetadata {
  // both cli_version and origin_version are set to `cliVersion`
  // origin_version is added to be consistent with `origin` field:
  // elf_symbols uploads can also be done by fullhost profiler
  // which will use `origin` and `origin_version` fields since
  // it's not really a CLI.
  cli_version: string
  origin_version: string

  arch: string
  origin: string
  git_commit_sha?: string
  git_repository_url?: string
  gnu_build_id: string
  go_build_id: string
  file_hash: string
  symbol_source: string
  filename: string
  type: string
  overwrite: boolean
}
