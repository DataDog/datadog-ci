import type {SpanTags} from '../interfaces'

import simpleGit from 'simple-git'

import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_DATE,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_DATE,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_COMMIT_MESSAGE,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '../tags'
import {filterSensitiveInfoFromRepository} from '../utils'

import {gitAuthorAndCommitter, gitBranch, gitHash, gitMessage, gitRepositoryURL} from './get-git-data'

export const getGitMetadata = async (path: string | undefined): Promise<SpanTags> => {
  try {
    const git = simpleGit({
      baseDir: path || process.cwd(),
      binary: 'git',
      // We are invoking at most 5 git commands at the same time.
      maxConcurrentProcesses: 5,
    })

    const [commitSHA, branch, repositoryUrl, message, authorAndCommitter] = await Promise.all([
      gitHash(git),
      gitBranch(git),
      gitRepositoryURL(git),
      gitMessage(git),
      gitAuthorAndCommitter(git),
    ])

    const [
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
    ] = authorAndCommitter.split(',')

    return {
      [GIT_REPOSITORY_URL]: filterSensitiveInfoFromRepository(repositoryUrl.trim()),
      [GIT_BRANCH]: branch.current,
      [GIT_SHA]: commitSHA,
      [GIT_COMMIT_MESSAGE]: message.trim(),
      [GIT_COMMIT_COMMITTER_DATE]: committerDate.trim(),
      [GIT_COMMIT_COMMITTER_EMAIL]: committerEmail.trim(),
      [GIT_COMMIT_COMMITTER_NAME]: committerName.trim(),
      [GIT_COMMIT_AUTHOR_DATE]: authorDate.trim(),
      [GIT_COMMIT_AUTHOR_EMAIL]: authorEmail.trim(),
      [GIT_COMMIT_AUTHOR_NAME]: authorName.trim(),
    }
  } catch (e) {
    return {}
  }
}
