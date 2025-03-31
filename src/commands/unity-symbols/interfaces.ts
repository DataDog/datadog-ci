export const TYPE_IL2CPP_MAPPING = 'il2cpp_mapping_file'
export const VALUE_NAME_IL2CPP_MAPPING = 'il2cpp_mapping_file'
export const IL2CPP_MAPPING_FILE_NAME = 'LineNumberMappings.json'

export const TYPE_NDK_SYMBOL_FILE = 'ndk_symbol_file'
export const VALUE_NAME_NDK_SYMBOL_FILE = 'ndk_symbol_file'

export interface MappingMetadata {
  arch?: string
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  platform?: string
  build_id: string
  type: string
}
