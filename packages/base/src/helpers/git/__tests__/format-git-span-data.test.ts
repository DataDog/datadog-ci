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
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: async (git: any): Promise<string> => 'repository_url',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName:authorName\nauthorEmail:authorEmail\nauthorDate:authorDate\ncommitterName:committerName\ncommitterEmail:committerEmail\ncommitterDate:committerDate'
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
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
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

  it('scrubs credentials from https repository url', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: async (git: any): Promise<string> =>
        'https://x-oauth-basic:ghp_safe_characters@github.com/datadog/safe-repository.git',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName:authorName\nauthorEmail:authorEmail\nauthorDate:authorDate\ncommitterName:committerName\ncommitterEmail:committerEmail\ncommitterDate:committerDate'
      },
    }))
    const result = await getGitMetadata()
    expect(result).toEqual({
      [GIT_REPOSITORY_URL]: 'https://github.com/datadog/safe-repository.git',
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

  it('scrubs credentials from ssh repository url', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: async (git: any): Promise<string> => 'ssh://username@host.xz:port/path/to/repo.git/',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName:authorName\nauthorEmail:authorEmail\nauthorDate:authorDate\ncommitterName:committerName\ncommitterEmail:committerEmail\ncommitterDate:committerDate'
      },
    }))
    const result = await getGitMetadata()
    expect(result).toEqual({
      [GIT_REPOSITORY_URL]: 'ssh://host.xz:port/path/to/repo.git/',
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
})
