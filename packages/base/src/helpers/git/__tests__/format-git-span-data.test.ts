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
} from '../../tags'

import {getGitCommitParents, getGitMetadata} from '../format-git-span-data'

jest.mock('simple-git')

describe('getGitCommitParents', () => {
  test('reads only parent headers of a pinned commit, without walking parent objects', async () => {
    const raw = jest
      .fn()
      .mockResolvedValue(
        `tree ${'d'.repeat(40)}\nparent ${'a'.repeat(40)}\nparent ${'b'.repeat(40)}\nauthor Author\n\nparent ${'c'.repeat(40)}\n`
      )
    ;(simpleGit as jest.Mock).mockImplementation(() => ({raw}))
    expect(await getGitCommitParents('e'.repeat(40))).toEqual(['a'.repeat(40), 'b'.repeat(40)])
    expect(raw).toHaveBeenCalledWith(['cat-file', 'commit', 'e'.repeat(40)])
  })

  test('treats an unavailable commit as inconclusive', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      raw: jest.fn().mockRejectedValue(new Error('unavailable')),
    }))
    expect(await getGitCommitParents('a'.repeat(40))).toBeUndefined()
  })

  test('does not execute an arbitrary revision expression', async () => {
    jest.mocked(simpleGit).mockClear()
    expect(await getGitCommitParents('HEAD^')).toBeUndefined()
    expect(simpleGit).not.toHaveBeenCalled()
  })
})

describe('getGitMetadata', () => {
  it('retains a readable commit when optional repository metadata is unavailable', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      revparse: async () => 'a'.repeat(40),
      raw: async () => {
        throw new Error('branch unavailable')
      },
      listRemote: async () => {
        throw new Error('no remote')
      },
      show: async () => {
        throw new Error('metadata unavailable')
      },
    }))
    expect(await getGitMetadata()).toEqual({[GIT_SHA]: 'a'.repeat(40)})
  })

  it('does not report HEAD as a branch and retains a local tag', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      revparse: async () => 'a'.repeat(40),
      listRemote: async () => '',
      show: async () => '',
      raw: async (args: string[]) => (args[0] === 'describe' ? 'v1\n' : ''),
    }))
    expect(await getGitMetadata()).toEqual({[GIT_SHA]: 'a'.repeat(40), [GIT_TAG]: 'v1'})
  })

  it('reads git metadata successfully', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      listRemote: async (git: any): Promise<string> => 'repository_url',
      revparse: () => 'commitSHA',
      raw: (input: string[]) => {
        if (input[0] === 'branch') {
          return 'main'
        }
        if (input[0] === 'describe') {
          return ''
        }
        if (input.includes('--format=%s')) {
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
      listRemote: async (git: any): Promise<string> =>
        'https://x-oauth-basic:ghp_safe_characters@github.com/datadog/safe-repository.git',
      revparse: () => 'commitSHA',
      raw: (input: string[]) => {
        if (input[0] === 'branch') {
          return 'main'
        }
        if (input[0] === 'describe') {
          return ''
        }
        if (input.includes('--format=%s')) {
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
      listRemote: async (git: any): Promise<string> => 'ssh://username@host.xz:port/path/to/repo.git/',
      revparse: () => 'commitSHA',
      raw: (input: string[]) => {
        if (input[0] === 'branch') {
          return 'main'
        }
        if (input[0] === 'describe') {
          return ''
        }
        if (input.includes('--format=%s')) {
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
