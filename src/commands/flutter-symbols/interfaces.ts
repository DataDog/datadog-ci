export const TYPE_JVM_MAPPING = 'jvm_mapping_file'
export const VALUE_NAME_JVM_MAPPING = 'jvm_mapping_file'
export const JVM_MAPPING_FILE_NAME = 'jvm_mapping'
export const TYPE_DART_SYMBOLS = 'dart_symbols_file'

export interface MappingMetadata {
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  service: string
  type: string
  variant: string
  version: string
}
