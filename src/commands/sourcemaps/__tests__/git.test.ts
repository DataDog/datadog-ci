import {getRepositoryData, gitRemote, stripCredentials, TrackedFilesMatcher} from '../git'

describe('git', () => {
  describe('gitRemote', () => {
    const createMockSimpleGit = (remotes: any[]) => ({
      getRemotes: (arg: boolean) => remotes,
    })

    test('should choose the remote named origin', async () => {
      const mock = createMockSimpleGit([
        {name: 'first', refs: {push: 'remote1'}},
        {name: 'origin', refs: {push: 'remote2'}},
      ]) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote2')
    })
    test('should choose the first remote', async () => {
      const mock = createMockSimpleGit([
        {name: 'first', refs: {push: 'remote1'}},
        {name: 'second', refs: {push: 'remote2'}},
      ]) as any
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

  describe('trackedFileIsRelated', () => {
    test('related path', () => {
      const sources = ['webpack:///./src/commands/sourcemaps/__tests__/git.test.ts']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/git.test.ts']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
    })
    test('related path with query parameter', () => {
      const sources = ['git.test.ts?abc123']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/git.test.ts']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
    })
    test('related path with legit question mark', () => {
      const sources = ['git.test.ts?abc123']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/git.test.ts?abc123']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
    })
    test('related hidden file', () => {
      const sources = ['folder/.git.test.ts']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/.git.test.ts']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
    })
    test('not related', () => {
      const sources = ['folder/other.test.ts']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/git.test.ts']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toHaveLength(0)
    })
    test('filename not at the end of tracked file', () => {
      const sources = ['webpack:///./.yarn/cache/testfile.js-npm-1.2.3-abc1234567-abc1234567.zip/node_modules/testfile.js/testfile.js']
      const trackedFiles = ['.yarn/cache/testfile.js-npm-1.1.1-abc1234567-abc1234567.zip']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toHaveLength(0)
    })
    test('multiple related path with same filename', () => {
      const sources = ['webpack:///./src/commands/sourcemaps/__tests__/git.test.ts']
      const trackedFiles = ['src/commands/sourcemaps/__tests__/git.test.ts', 'src/commands/sourcemaps/git.test.ts']
      const matcher = new TrackedFilesMatcher(trackedFiles)
      expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
    })
  })

  describe('GetRepositoryData', () => {
    const createMockStdout = () => {
      let data = ''

      return {
        toString: () => data,
        write: (input: string) => {
          data += input
        },
      }
    }

    const createMockSimpleGit = () => ({
      getRemotes: (arg: boolean) => [{refs: {push: 'git@github.com:user/repository.git'}}],
      raw: (arg: string) => 'src/commands/sourcemaps/__tests__/git.test.ts',
      revparse: (arg: string) => '25da22df90210a40b919debe3f7ebfb0c1811898',
    })

    test('integration', async () => {
      const stdout = createMockStdout() as any
      const data = await getRepositoryData(createMockSimpleGit() as any, stdout, '')
      if (!data) {
        fail('data should not be undefined')
      }
   
      const files = await data.trackedFilesMatcher.matchSourcemap(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
      )
      expect(data.remote).toBe('git@github.com:user/repository.git')
      expect(data.hash).toBe('25da22df90210a40b919debe3f7ebfb0c1811898')
      expect(files).toStrictEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })

    test('integration: remote override', async () => {
      const stdout = createMockStdout() as any
      const data = await getRepositoryData(createMockSimpleGit() as any, stdout, 'git@github.com:user/other.git')
      if (!data) {
        fail('data should not be undefined')
      }
      const files = await data.trackedFilesMatcher.matchSourcemap(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
      )
      expect(data.remote).toBe('git@github.com:user/other.git')
      expect(data.hash).toBe('25da22df90210a40b919debe3f7ebfb0c1811898')
      expect(files).toStrictEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })
  })
})
