export const TYPE_JVM_MAPPING = 'jvm_mapping_file'
export const VALUE_NAME_JVM_MAPPING = 'jvm_mapping_file'
export const JVM_MAPPING_FILE_NAME = 'jvm_mapping'
export const TYPE_DART_SYMBOLS = 'flutter_symbol_file'
export const VALUE_NAME_DART_MAPPING = 'flutter_symbol_file'
export const DART_SYMBOL_FILE_NAME = 'flutter_symbol_file'

export interface MappingMetadata {
  arch?: string
  build_id?: string
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  platform?: string
  service?: string
  type: string
  variant?: string
  version?: string
}
