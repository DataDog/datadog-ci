import {MachineArchitecture} from './pe-constants'

export const TYPE_PE_DEBUG_INFOS = 'pe_symbol_file'
export const VALUE_NAME_PE_DEBUG_INFOS = 'pe_symbol_file'
export const PE_DEBUG_INFOS_FILENAME = 'pe_symbol_file'

export interface MappingMetadata {
  // both cli_version and origin_version are set to `cliVersion`
  // origin_version is added to be consistent with `origin` field:
  // pe_symbols uploads can also be done by fullhost profiler
  // which will use `origin` and `origin_version` fields since
  // it's not really a CLI.
  cli_version: string
  origin_version: string

  arch: string
  pdb_age: number
  pdb_sig?: string
  filename: string
  origin: string // will contain 'datadog-ci'
  type: string
  overwrite: boolean

  // origin: string
  git_commit_sha?: string
  git_repository_url?: string
  // gnu_build_id: string
  // go_build_id: string
  // file_hash: string
  symbol_source: string  // will contain 'debug_info'
}
