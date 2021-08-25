import {getCommitInfo, gitRemote, stripCredentials} from '../git'

interface MockConfig {
  hash?: string
  remotes?: any[]
  trackedFiles?: string[]
}

const createMockSimpleGit = (conf: MockConfig) => ({
  getRemotes: async (_: boolean) => {
    if (conf.remotes === undefined) {
      throw Error('Unexpected call to getRemotes')
    }

    return conf.remotes!
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

    return conf.hash!
  },
})

describe('git', () => {
  describe('gitRemote', () => {
    test('should choose the remote named origin', async () => {
      const mock = createMockSimpleGit({
        remotes: [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'origin', refs: {push: 'remote2'}},
        ],
      }) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote2')
    })
    test('should choose the first remote', async () => {
      const mock = createMockSimpleGit({
        remotes: [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'second', refs: {push: 'remote2'}},
        ],
      }) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote1')
    })
  })

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
      const commitInfo = await getCommitInfo(mock, process.stdout)

      expect(commitInfo).toBeDefined()
      expect(commitInfo!.hash).toBe('abcd')
      expect(commitInfo!.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo!.remote).toBe('https://git-repo/')
    })
    test('should return commit info with overridden repo name', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock, process.stdout, 'https://overridden')

      expect(commitInfo).toBeDefined()
      expect(commitInfo!.hash).toBe('abcd')
      expect(commitInfo!.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo!.remote).toBe('https://overridden')
    })
  })
})
