import type {SpanTags} from '../interfaces'

import {simpleGit} from 'simple-git'

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
  GIT_TAG,
} from '../tags'
import {filterSensitiveInfoFromRepository, isValidGitSha, normalizeGitSha, removeEmptyValues} from '../utils'

import {DEFAULT_GIT_OPTIONS} from './default-options'
import {gitAuthorAndCommitter, gitCurrentBranch, gitHash, gitMessage, gitRepositoryURL} from './get-git-data'
import {withGitRepositoryEnvironment} from './repository-environment'

const createGit = (repositoryPath?: string) =>
  withGitRepositoryEnvironment(
    simpleGit({...DEFAULT_GIT_OPTIONS, baseDir: repositoryPath || process.cwd(), maxConcurrentProcesses: 5}),
    process.cwd()
  )

const readOptional = async <T>(read: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await read()
  } catch {
    return undefined
  }
}

export const getGitRoot = (repositoryPath?: string) =>
  readOptional(() => createGit(repositoryPath).revparse('--show-toplevel'))

export const getGitCommitParents = async (revision: string, repositoryPath?: string): Promise<string[] | undefined> => {
  if (!isValidGitSha(revision)) {
    return undefined
  }

  return readOptional(async () => {
    const commit = await createGit(repositoryPath).raw(['cat-file', 'commit', revision])
    const header = commit.split('\n\n', 1)[0]

    return [...header.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((match) => match[1])
  })
}

export const getGitMetadata = async (repositoryPath?: string): Promise<SpanTags> => {
  try {
    const git = createGit(repositoryPath)
    // Only an unreadable HEAD makes the checkout unavailable. Optional fields must not select a different source.
    const commitSHA = await gitHash(git)
    const [branch, repositoryUrl, message, authorAndCommitter, tag] = await Promise.all([
      readOptional(() => gitCurrentBranch(git)),
      readOptional(() => gitRepositoryURL(git)),
      readOptional(() => gitMessage(git, commitSHA)),
      readOptional(() => gitAuthorAndCommitter(git, commitSHA)),
      readOptional(() => git.raw(['describe', '--tags', '--exact-match', commitSHA])),
    ])

    return removeEmptyValues({
      [GIT_REPOSITORY_URL]: filterSensitiveInfoFromRepository(repositoryUrl?.trim()),
      [GIT_BRANCH]: branch,
      [GIT_SHA]: normalizeGitSha(commitSHA.trim()),
      [GIT_TAG]: tag?.trim(),
      [GIT_COMMIT_MESSAGE]: message?.trim(),
      [GIT_COMMIT_COMMITTER_DATE]: authorAndCommitter?.committerDate?.trim(),
      [GIT_COMMIT_COMMITTER_EMAIL]: authorAndCommitter?.committerEmail?.trim(),
      [GIT_COMMIT_COMMITTER_NAME]: authorAndCommitter?.committerName?.trim(),
      [GIT_COMMIT_AUTHOR_DATE]: authorAndCommitter?.authorDate?.trim(),
      [GIT_COMMIT_AUTHOR_EMAIL]: authorAndCommitter?.authorEmail?.trim(),
      [GIT_COMMIT_AUTHOR_NAME]: authorAndCommitter?.authorName?.trim(),
    })
  } catch (e) {
    return {}
  }
}
