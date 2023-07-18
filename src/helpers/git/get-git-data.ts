import {URL} from 'url'

import * as simpleGit from 'simple-git'
import {BranchSummary} from 'simple-git'

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

export const gitMessage = async (git: simpleGit.SimpleGit): Promise<string> => git.show(['-s', '--format=%s'])

export const gitAuthorAndCommitter = async (git: simpleGit.SimpleGit): Promise<string> =>
  git.show(['-s', '--format=%an,%ae,%aI,%cn,%ce,%cI'])

export const gitRepositoryURL = async (git: simpleGit.SimpleGit): Promise<string> => git.listRemote(['--get-url'])
