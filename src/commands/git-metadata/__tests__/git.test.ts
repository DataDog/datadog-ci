import * as simpleGit from 'simple-git'

import {getCommitInfo, newSimpleGit, stripCredentials} from '../git'

interface MockConfig {
  hash?: string
  remotes?: any[]
  trackedFiles?: string[]
}

const createMockSimpleGit = (conf: MockConfig) => ({
  // eslint-disable-next-line no-null/no-null
  getConfig: (_: string) => ({value: null}),
  getRemotes: async (_: boolean) => {
    if (conf.remotes === undefined) {
      throw Error('Unexpected call to getRemotes')
    }

    return conf.remotes
  },
  raw: async (command: string) => {
    if (command === 'ls-files' && conf.trackedFiles !== undefined) {
      return conf.trackedFiles.join('\n') + '\n'
    }
    throw Error(`Unexpected call to raw(${command})`)
  },
  revparse: async (_: string) => {
    if (conf.hash === undefined) {
      throw Error('Unexpected call to revparse')
    }

    return conf.hash
  },
})

describe('git', () => {
  describe('stripCredentials: git protocol', () => {
    test('should return the same value', () => {
      const input = 'git@github.com:user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })
  })
  describe('stripCredentials: nothing to remove', () => {
    test('should return the same value', () => {
      const input = 'https://gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })
  })
  describe('stripCredentials: user:pwd', () => {
    test('should return without credentials', () => {
      const input = 'https://token:[MASKED]@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })
  })
  describe('stripCredentials: token', () => {
    test('should return without credentials', () => {
      const input = 'https://token@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })
  })
  describe('getCommitInfo', () => {
    test('should return commit info from simple git', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        remotes: [{name: 'first', refs: {push: 'https://git-repo'}}],
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock)

      expect(commitInfo).toBeDefined()
      expect(commitInfo.hash).toBe('abcd')
      expect(commitInfo.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo.remote).toBe('https://git-repo/')
    })

    test('should return commit info with overridden repo name', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock, 'https://overridden')

      expect(commitInfo).toBeDefined()
      expect(commitInfo.hash).toBe('abcd')
      expect(commitInfo.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo.remote).toBe('https://overridden')
    })
  })

  describe('newSimpleGit', () => {
    test('should throw an error if git is not installed', async () => {
      jest.spyOn(simpleGit, 'simpleGit').mockImplementation(() => {
        throw Error('gitp error')
      })
      await expect(newSimpleGit()).rejects.toThrow('gitp error')
    })

    test('should throw an error if revparse throws an error', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'simpleGit').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockImplementation(async () => {
        throw Error('revparse error')
      })

      await expect(newSimpleGit()).rejects.toThrow('revparse error')
    })

    test('should not throw any errors', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'simpleGit').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockResolvedValue('1234')

      await expect(newSimpleGit()).resolves.not.toThrow()
    })
  })
})
