// Discovery of the repository files that are uploaded alongside coverage reports: the code coverage
// configuration (`code-coverage.datadog.yml`) and `CODEOWNERS`.
//
// Both are looked up in the committed tree (path + git blob SHA only) and in the working directory.
// A file found in the working directory is attached to the upload, which is what makes a
// configuration generated during the CI run usable.

import {createHash} from 'crypto'
import fs from 'fs'

import upath from 'upath'

export const COVERAGE_CONFIG_PATHS = ['code-coverage.datadog.yml', 'code-coverage.datadog.yaml']

export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']

// Files larger than this are not attached: the backend keeps them in reducer state and in blob
// storage, and CODEOWNERS files in large monorepos can grow arbitrarily.
export const MAX_ATTACHED_FILE_SIZE = 1024 * 1024

export interface FileOnDisk {
  // Path reported to the backend: repository-relative whenever the file is inside the repository.
  path: string
  absolutePath: string
  size: number
}

/**
 * Computes the git blob SHA-1 of the given content: `sha1("blob " + byteLength + "\0" + content)`.
 * Matches `git hash-object`, so a file read from disk and the same file read from the committed tree
 * produce the same SHA, and the backend content cache stays content-addressed.
 */
export const gitBlobSha = (content: Buffer): string =>
  createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')

/**
 * Returns the first of `candidates` that exists as a readable file under any of `searchRoots`.
 * Roots are tried in order first, so the repository root wins over the current directory.
 */
export const findFileInSearchRoots = (candidates: string[], searchRoots: string[]): FileOnDisk | undefined => {
  for (const root of searchRoots) {
    for (const candidate of candidates) {
      const found = statFileOnDisk(upath.resolve(root, candidate), candidate)
      if (found) {
        return found
      }
    }
  }

  return undefined
}

/**
 * Stats a single file, returning `undefined` when it does not exist, is not a regular file, or is
 * not readable. `reportedPath` overrides the path sent to the backend, which is repository-relative.
 */
export const statFileOnDisk = (absolutePath: string, reportedPath?: string): FileOnDisk | undefined => {
  try {
    const stats = fs.statSync(absolutePath)
    if (!stats.isFile()) {
      return undefined
    }
    fs.accessSync(absolutePath, fs.constants.R_OK)

    return {
      path: reportedPath ?? upath.normalize(absolutePath),
      absolutePath: upath.normalize(absolutePath),
      size: stats.size,
    }
  } catch {
    return undefined
  }
}

/**
 * Makes `absolutePath` relative to `repositoryRoot` when it is inside it, so that `config.path` and
 * `codeowners.path` stay repository-relative like the git-derived ones. Falls back to the
 * normalized absolute path for files outside of the repository.
 */
export const toRepositoryRelativePath = (absolutePath: string, repositoryRoot: string | undefined): string => {
  const normalized = upath.normalize(absolutePath)
  if (!repositoryRoot) {
    return normalized
  }

  const relative = upath.relative(upath.normalize(repositoryRoot), normalized)
  if (!relative || relative.startsWith('../') || upath.isAbsolute(relative)) {
    return normalized
  }

  return relative
}
