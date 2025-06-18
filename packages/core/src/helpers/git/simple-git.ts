import type {SimpleGit} from 'simple-git'

import {GitConfigScope, simpleGit} from 'simple-git'

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<SimpleGit> => {
  const currentDir = process.cwd()
  const options = {
    baseDir: currentDir,
    binary: 'git',
    maxConcurrentProcesses: 1,
  }

  const git = simpleGit(options)

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

  return simpleGit(options)
}
