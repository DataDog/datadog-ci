import {URL} from 'url'

import * as simpleGit from 'simple-git'
import {BranchSummary} from 'simple-git'

import {GitAuthorAndCommitterMetadata} from '../interfaces'

// Returns the remote of the current repository.
export const gitRemote = async (git: simpleGit.SimpleGit): Promise<string> => {
  const remotes = await git.getRemotes(true)
  if (remotes.length === 0) {
    throw new Error('No git remotes available')
  }
  const defaultRemote = await getDefaultRemoteName(git)

  for (const remote of remotes) {
    if (remote.name === defaultRemote) {
      return stripCredentials(remote.refs.push)
    }
  }

  // Falling back to picking the first remote in the list if the default remote is not found.
  return stripCredentials(remotes[0].refs.push)
}

export const getDefaultRemoteName = async (git: simpleGit.SimpleGit): Promise<string> => {
  try {
    return (await git.getConfig('clone.defaultRemoteName'))?.value ?? 'origin'
  } catch (e) {
    return 'origin'
  }
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
export const gitHash = async (git: simpleGit.SimpleGit): Promise<string> => git.revparse('HEAD')

// Returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: simpleGit.SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')

  return files.split(/\r\n|\r|\n/)
}

export const gitBranch = async (git: simpleGit.SimpleGit): Promise<BranchSummary> => git.branch()

export const gitCurrentBranch = async (git: simpleGit.SimpleGit): Promise<string> => {
  const branch = await git.raw(['branch', '--show-current'])

  return branch.trim()
}

export const gitMessage = async (git: simpleGit.SimpleGit): Promise<string> => git.show(['-s', '--format=%s'])

// Returns the author and committer information of the current commit.
export const gitAuthorAndCommitter = async (git: simpleGit.SimpleGit): Promise<GitAuthorAndCommitterMetadata> => {
  const info = await git.show([
    '-s',
    `--format=${['authorName:%an', 'authorEmail:%ae', 'authorDate:%aI', 'committerName:%cn', 'committerEmail:%ce', 'committerDate:%cI'].join('%n')}`,
  ])
  const output: {[_: string]: any} = {}
  for (const line of info.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      output[line.substring(0, idx)] = line.substring(idx + 1)
    }
  }

  return output as GitAuthorAndCommitterMetadata
}

export const gitRepositoryURL = async (git: simpleGit.SimpleGit): Promise<string> =>
  git.listRemote(['--get-url']).then((url) => url.trim())

export const gitLocalCommitShas = async (git: simpleGit.SimpleGit, branchName: string): Promise<string[]> => {
  const gitShas = await git.raw(['log', branchName, '--not', '--remotes', '--format=%H', '-n', '10'])

  return gitShas.split(/\r\n|\r|\n/).filter(Boolean) // split by new line and discarding empty lines
}
