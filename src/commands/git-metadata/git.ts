import {URL} from 'url'

import * as simpleGit from 'simple-git'
import {GitConfigScope} from 'simple-git'

import {gitRemote} from '../../helpers/git/get-git-data'

import {CommitInfo} from './interfaces'

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<simpleGit.SimpleGit> => {
  const currentDir = process.cwd()
  const options = {
    baseDir: currentDir,
    binary: 'git',
    maxConcurrentProcesses: 1,
  }

  const git = simpleGit.simpleGit(options)

  try {
    // In some CI envs repo may be checked out as a different user than the one running the command.
    // To be able to run git commands, we need to add the current directory as a safe directory.
    await git.addConfig('safe.directory', currentDir, true, GitConfigScope.global)
  } catch (e) {
    // Ignore the error
  }

  // Attempt to set the baseDir to the root of the repository so the 'git ls-files' command
  // returns the tracked files paths relative to the root of the repository.
  const root = await git.revparse('--show-toplevel')
  options.baseDir = root

  return simpleGit.simpleGit(options)
}

// StripCredentials removes credentials from a remote HTTP url.
export const stripCredentials = (remote: string) => {
  try {
    const url = new URL(remote)
    url.username = ''
    url.password = ''

    return url.toString()
  } catch {
    return remote
  }
}

// Returns the hash of the current repository.
const gitHash = async (git: simpleGit.SimpleGit): Promise<string> => git.revparse('HEAD')

// Returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: simpleGit.SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')

  return files.split(/\r\n|\r|\n/).filter((s) => s !== '')
}

// Returns the current hash, remote URL and tracked files paths.
export const getCommitInfo = async (git: simpleGit.SimpleGit, repositoryURL?: string): Promise<CommitInfo> => {
  // Invoke git commands to retrieve the remote, hash and tracked files.
  // We're using Promise.all instead of Promise.allSettled since we want to fail early if
  // any of the promises fails.
  let remote: string
  let hash: string
  let trackedFiles: string[]
  if (repositoryURL) {
    ;[hash, trackedFiles] = await Promise.all([gitHash(git), gitTrackedFiles(git)])
    remote = repositoryURL
  } else {
    ;[remote, hash, trackedFiles] = await Promise.all([gitRemote(git), gitHash(git), gitTrackedFiles(git)])
  }

  return new CommitInfo(hash, remote, trackedFiles)
}

export const getGitDiff = async (git: simpleGit.SimpleGit, from: string, to: string): Promise<DiffData> => {
  const fromResolved = await git.revparse(from)
  const toResolved = await git.revparse(to)

  const rawDiff = await git.diff([
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--diff-algorithm=minimal',
    `${fromResolved}..${toResolved}`,
  ])

  return {
    head_sha: toResolved,
    base_sha: fromResolved,
    files: parseGitDiff(rawDiff),
  }
}

export interface DiffData {
  head_sha: string
  base_sha: string
  files: Record<string, DiffNode>
}

export interface DiffNode {
  added_lines: string // base-64 bit-vector
  removed_lines: string // base-64 bit-vector
}

const diffHeaderRegex = /^diff --git a\/.+ b\/(.+)$/
const hunkHeaderRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export const parseGitDiff = (diff: string): Record<string, DiffNode> => {
  const root: Record<string, DiffNode> = {}

  interface Buffer {
    addedLines: Set<number>
    removedLines: Set<number>
  }
  let currentPath: string | undefined
  let currentLines: Buffer | undefined

  for (const line of diff.split(/\r?\n/)) {
    const diffHeader = diffHeaderRegex.exec(line)
    if (diffHeader) {
      if (currentPath && currentLines) {
        root[currentPath] = {
          added_lines: base64Encode(currentLines.addedLines),
          removed_lines: base64Encode(currentLines.removedLines),
        }
      }

      currentPath = diffHeader[1]
      currentLines = {addedLines: new Set(), removedLines: new Set()}
      continue
    }

    if (!currentLines) {
      // still before first diff-header
      continue
    }

    const hunkHeader = hunkHeaderRegex.exec(line)
    if (hunkHeader) {
      const oldStart = Number(hunkHeader[1])
      const oldLen = Number(hunkHeader[2] ?? 1)
      const newStart = Number(hunkHeader[3])
      const newLen = Number(hunkHeader[4] ?? 1)

      for (let i = 0; i < oldLen; i++) {
        currentLines.removedLines.add(oldStart + i)
      }
      for (let i = 0; i < newLen; i++) {
        currentLines.addedLines.add(newStart + i)
      }
    }
  }

  if (currentPath && currentLines) {
    root[currentPath] = {
      added_lines: base64Encode(currentLines.addedLines),
      removed_lines: base64Encode(currentLines.removedLines),
    }
  }

  return root
}

const base64Encode = (set: Set<number>): string => {
  const maxBit = set.size ? Math.max(...set) : 0
  if (maxBit === 0) {
    return ''
  }
  const bytes = new Uint8Array(Math.ceil(maxBit / 8))
  for (const n of set) {
    const idx = n - 1
    // eslint-disable-next-line no-bitwise
    bytes[idx >> 3] |= 1 << (idx & 7)
  }

  return Buffer.from(bytes).toString('base64')
}
