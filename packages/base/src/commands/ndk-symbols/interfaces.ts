export const TYPE_NDK_SYMBOL_FILE = 'ndk_symbol_file'
export const VALUE_NAME_NDK_SYMBOL_FILE = 'ndk_symbol_file'

// Architecture names expected by the symbolication backend for NDK symbol files
// (the same names the Datadog Android Gradle plugin sends).
export type NdkArch = 'arm' | 'arm64' | 'x86' | 'x64'

export interface NdkSymbolFileMetadata {
  arch: NdkArch
  build_id: string
  cli_version: string
  type: string

  service?: string
  version?: string
  variant?: string

  git_commit_sha?: string
  git_repository_url?: string
}
