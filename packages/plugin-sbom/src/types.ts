export enum DependencyLanguage {
  DOTNET = 'dotnet',
  NPM = 'node',
  PYTHON = 'python',
  PHP = 'php',
  RUST = 'rust',
  RUBY = 'ruby',
  GO = 'go',
  JVM = 'jvm',
  C_CPP = 'c_cpp',
}

// Location represents the location object stored in a file from osv-scanner.
// {\"file_name\":\"package-lock.json\",\"line_start\":19328,\"line_end\":19336,\"column_start\":9,\"column_end\":10}}
export interface LocationFromFile {
  file_name: string
  line_start: number
  line_end: number
  column_start: number
  column_end: number
}

// The position is a position start/end sent to the backend
export interface Position {
  line: number
  col: number
}

// The location object set by osv-scanner
export interface Location {
  file_name: string
  start: Position
  end: Position
}

// All the locations for the dependency
export interface Locations {
  block: undefined | Location
  namespace: undefined | Location
  name: undefined | Location
  version: undefined | Location
}

export interface Property {
  name: string
  value: string
}

export interface Dependency {
  name: string
  version: undefined | string
  group: undefined | string
  language: DependencyLanguage
  purl: string
  locations: undefined | Locations[]
  is_direct: undefined | boolean
  is_dev: undefined | boolean
  package_manager: string
  reachable_symbol_properties: undefined | Property[]
  exclusions: undefined | string[]
  target_frameworks: undefined | string[]
  opaque: undefined | boolean
  version_constraint: undefined | boolean
  version_range: undefined | string
  requires_transitive_enrichment: undefined | boolean
}

export interface ReachableSymbolLocationValue extends LocationFromFile {
  symbol: string
}

export interface CommitInformation {
  author_name: string
  author_email: string
  committer_name: string
  committer_email: string
  sha: string
  branch: string
}

export interface RepositoryInformation {
  url: string
}

export interface File {
  name: string
  purl: string | undefined
}

export interface Relations {
  ref: string
  depends_on: string[]
}

export interface Vulnerability {
  id: string
  bom_ref: string
  affects: Affect[]
}

export interface Affect {
  ref: string
}

export interface ScaRequest {
  id: string
  commit: CommitInformation
  repository: RepositoryInformation
  dependencies: Dependency[]
  files: File[]
  relations: Relations[]
  vulnerabilities: Vulnerability[]
  service: string
  env: string
  tags: Record<string, string>
}

export interface GenerationTool {
  name: string
  version: string
}
