import {gitRemote, stripCredentials} from '../get-git-data'

describe('git', () => {
  describe('gitRemote', () => {
    const createMockSimpleGit = (remotes: any[], defaultOrigin: string | undefined) => ({
      getRemotes: (arg: boolean) => remotes,
      getConfig: (arg: string) => ({
        // eslint-disable-next-line no-null/no-null
        value: defaultOrigin ?? null,
      }),
    })

    test('should choose the remote named origin if no default is specified', async () => {
      const mock = createMockSimpleGit(
        [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'origin', refs: {push: 'remote2'}},
        ],
        undefined
      ) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote2')
    })

    test('should choose the remote named first if that is the default origin', async () => {
      const mock = createMockSimpleGit(
        [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'origin', refs: {push: 'remote2'}},
        ],
        'first'
      ) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote1')
    })

    test('should choose the first remote', async () => {
      const mock = createMockSimpleGit(
        [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'second', refs: {push: 'remote2'}},
        ],
        undefined
      ) as any
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
})
