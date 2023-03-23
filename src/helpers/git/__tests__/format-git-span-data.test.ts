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
} from '../../tags'

import {getGitMetadata} from '../format-git-span-data'

jest.mock('simple-git')

describe('getGitMetadata', () => {
  it('reads git metadata successfully', async () => {
    ;(simpleGit as any).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: () => 'repository_url',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName,authorEmail,authorDate,committerName,committerEmail,committerDate'
      },
    }))
    const result = await getGitMetadata()
    expect(result).toEqual({
      [GIT_REPOSITORY_URL]: 'repository_url',
      [GIT_BRANCH]: 'main',
      [GIT_SHA]: 'commitSHA',
      [GIT_COMMIT_MESSAGE]: 'commit message',
      [GIT_COMMIT_COMMITTER_DATE]: 'committerDate',
      [GIT_COMMIT_COMMITTER_EMAIL]: 'committerEmail',
      [GIT_COMMIT_COMMITTER_NAME]: 'committerName',
      [GIT_COMMIT_AUTHOR_DATE]: 'authorDate',
      [GIT_COMMIT_AUTHOR_EMAIL]: 'authorEmail',
      [GIT_COMMIT_AUTHOR_NAME]: 'authorName',
    })
  })
  it('does not crash when git is not available', async () => {
    ;(simpleGit as any).mockImplementation(() => ({
      branch: () => {
        throw new Error()
      },
      listRemote: () => {
        throw new Error()
      },
      revparse: () => {
        throw new Error()
      },
      show: () => {
        throw new Error()
      },
    }))
    const result = await getGitMetadata()
    expect(result).toEqual({})
  })
})
