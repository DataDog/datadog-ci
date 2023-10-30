export enum DependencyLanguage {
  NPM = 'node',
  PYTHON = 'python',
  PHP = 'php',
  RUST = 'rust',
  RUBY = 'ruby',
  GO = 'go',
  JVM = 'jvm',
}

// List from https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
export enum DependencyLicense {
  AFL3 = 'AFL-3.0',
  APACHE2 = 'Apache-2.0',
  ARTISTIC2 = 'Artistic-2.0',
  BSL1 = 'BSL-1.0',
  BSD2CLAUSE = 'BSD-2-Clause',
  BSD3CLAUSE = 'BSD-3-Clause',
  BSD3CLAUSECLEAR = 'BSD-3-Clause-Clear',
  BSD4CLAUSE = 'BSD-4-Clause',
  ZEROBSD = '0BSD',
  CC = 'CC',
  CC0_1_0 = 'CC0-1.0',
  CC_BY_4_0 = 'CC-BY-4.0',
  CC_BY_SA_4_0 = 'CC-BY-SA-4.0',
  WTFPL = 'WTFPL',
  ECL2_0 = 'ECL-2.0',
  EPL1_0 = 'EPL-1.0',
  EPL2_0 = 'EPL-2.0',
  EUPL1_1 = 'EUPL-1.1',
  AGPL3_0 = 'AGPL-3.0',
  GPL = 'GPL',
  GPL2_0 = 'GPL-2.0',
  GPL3_0 = 'GPL-3.0',
  LGPL = 'LGPL',
  LGPL2_1 = 'LGPL-2.1',
  LGPL3_0 = 'LGPL-3.0',
  ISC = 'ISC',
  LPPL_1_3C = 'LPPL-1.3c',
  MS_PL = 'MS-PL',
  MIT = 'MIT',
  MPL_2_0 = 'MPL-2.0',
  OSL_3_0 = 'OSL-3.0',
  POSTGRESQL = 'PostgreSQL',
  OFL_1_1 = 'OFL-1.1',
  NCSA = 'NCSA',
  UNLICENSE = 'Unlicense',
  ZLIB = 'Zlib',
}

export interface Dependency {
  name: string
  version: string
  language: DependencyLanguage
  licenses: DependencyLicense[]
}

export interface CommitInformation {
  author_name: string
  author_email: string
  sha: string
  branch: string
}

export interface RepositoryInformation {
  url: string
}

export interface ScaRequest {
  id: string
  commit: CommitInformation
  repository: RepositoryInformation
  dependencies: Dependency[]
  tags: Record<string, string>
}
