export const TYPE_JVM_MAPPING = 'jvm_mapping_file'
export const VALUE_NAME_JVM_MAPPING = 'jvm_mapping_file'
// The attachment name the backend looks for.
export const JVM_MAPPING_FILE_NAME = 'jvm_mapping'

export interface JvmMappingMetadata {
  build_id: string
  cli_version: string
  service: string
  type: string
  variant: string
  version: string

  git_commit_sha?: string
  git_repository_url?: string
}
