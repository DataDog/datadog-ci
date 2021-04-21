import simpleGit from 'simple-git'

import {GIT_BRANCH, GIT_REPOSITORY_URL, GIT_SHA} from './tags'

export const getGitMetadata = async () => {
  try {
    const git = simpleGit({
      baseDir: process.cwd(),
      binary: 'git',
      // We are invoking at most 3 git commands at the same time.
      maxConcurrentProcesses: 3,
    })

    const [commitSHA, branch, repositoryUrl] = await Promise.all([
      git.revparse('HEAD'),
      git.branch(),
      git.listRemote(['--get-url']),
    ])

    return {
      [GIT_REPOSITORY_URL]: repositoryUrl.trim(),
      [GIT_BRANCH]: branch.current,
      [GIT_SHA]: commitSHA,
    }
  } catch (e) {
    return {}
  }
}
