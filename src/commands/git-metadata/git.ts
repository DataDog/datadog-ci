import * as simpleGit from 'simple-git'
import {URL} from 'url'

import {CommitInfo} from './interfaces'

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<simpleGit.SimpleGit> => {
  const options = {
    baseDir: process.cwd(),
    binary: 'git',
    maxConcurrentProcesses: 1,
  }
  // Attempt to set the baseDir to the root of the repository so the 'git ls-files' command
  // returns the tracked files paths relative to the root of the repository.
  const git = simpleGit.gitP(options)
  const root = await git.revparse('--show-toplevel')
  options.baseDir = root

  return simpleGit.gitP(options)
}

// Returns the remote of the current repository.
export const gitRemote = async (git: simpleGit.SimpleGit): Promise<string> => {
  const remotes = await git.getRemotes(true)
  if (remotes.length === 0) {
    throw new Error('No git remotes available')
  }

  for (const remote of remotes) {
    // We're trying to pick the remote called with the default git name 'origin'.
    if (remote.name === 'origin') {
      return remote.refs.push
    }
  }

  // Falling back to picking the first remote in the list if 'origin' is not found.
  return remotes[0].refs.push
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

// NormalizeRemote must be used when tagging git.repository_url.
// It normalize a remote url by removing the scheme, credentials, port and .git suffix.
// It avoids colons ending up in the string.
// The output is akin to: "github.com/DataDog/datadog-ci"
export const normalizeRemote = (remote: string) => {
  if (remote.endsWith('.git')) {
    remote = remote.slice(0, -4)
  }
  try {
    const url = new URL(remote)
    if (url.protocol === '' || url.hostname === '') {
      throw Error('empty protocol')
    }

    return url.hostname + url.pathname
  } catch {
    const scpRepo = new RegExp(/^([\w.~-]+@)?(?<host>[\w.-]+):(?<path>[\w.\/-]+)(?:\\?|$)(.*)$/)
    const matches = remote.match(scpRepo)
    if (matches && matches.length >= 4) {
      return matches[2] + '/' + matches[3]
    }

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

  return new CommitInfo(hash, stripCredentials(remote), trackedFiles)
}
