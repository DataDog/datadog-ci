import * as simpleGit from 'simple-git'
import {GitConfigScope} from 'simple-git'

import {gitRemote} from './get-git-data'

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

// Returns the hash of the current repository.
const gitHash = async (git: simpleGit.SimpleGit): Promise<string> => git.revparse('HEAD')

// Returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: simpleGit.SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')

  return files.split(/\r\n|\r|\n/).filter((s) => s !== '')
}

export interface CommitInfo {
  hash: string
  remote: string
  trackedFiles: string[]
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

  return {hash, remote, trackedFiles}
}
