export const TYPE_ELF_DEBUG_INFOS = 'elf_debuginfo_file'
export const VALUE_NAME_ELF_DEBUG_INFOS = 'elf_debuginfo_file'
export const ELF_DEBUG_INFOS_FILENAME = 'elf_debuginfo_file'


export interface MappingMetadata {
  arch?: string
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  platform?: string
  build_id: string
  type: string
}
