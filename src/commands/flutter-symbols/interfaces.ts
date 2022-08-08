export const MAPPING_TYPE_JVM_MAPPING = 'jvm_mapping_file'
export const MAPPING_TYPE_DART_SYMBOLS = 'dart_symbols_file'

export interface MappingMetadata {
  cli_version: string
  git_commit_sha?: string
  git_repository_url?: string
  service: string
  type: string
  variant: string
  version: string
}
