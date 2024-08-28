import {URL} from 'url'

import * as simpleGit from 'simple-git'

import {gitRemote} from '../../helpers/git/get-git-data'

export class CommitInfo {
  public hash: string
  public remote: string
  public trackedFiles: string[]

  constructor(hash: string, remote: string, trackedFiles: string[]) {
    this.hash = hash
    this.remote = remote
    this.trackedFiles = trackedFiles
  }
}

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<simpleGit.SimpleGit> => {
  const options = {
    baseDir: process.cwd(),
    binary: 'git',
    maxConcurrentProcesses: 1,
  }
  // Attempt to set the baseDir to the root of the repository so the 'git ls-files' command
  // returns the tracked files paths relative to the root of the repository.
  const git = simpleGit.simpleGit(options)
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
  // We're using Promise.all instead of Promive.allSettled since we want to fail early if
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
