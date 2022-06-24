import {getRepositoryData, gitRemote, stripCredentials, TrackedFilesMatcher} from '../git-sourcemaps-repository-data'

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

  describe('TrackedFilesMatcher', () => {
    describe('related cases', () => {
      test('related path', () => {
        const sources = ['webpack:///./src/file.ts']
        const trackedFiles = ['src/file.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
      })
      test('related path in another folder', () => {
        const sources = ['webpack:///./src/file.ts']
        const trackedFiles = ['path/to/file.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
      })
      test('related path with query parameter', () => {
        const sources = ['file.ts?abc123']
        const trackedFiles = ['src/file.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
      })
      test('related path with legit question mark', () => {
        const sources = ['file.ts?abc123']
        const trackedFiles = ['src/file.ts?abc123']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
      })
      test('related hidden file', () => {
        const sources = ['src/.file.ts']
        const trackedFiles = ['folder/.file.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(trackedFiles)
      })
    })
    describe('not related cases', () => {
      test('not related', () => {
        const sources = ['folder/other.ts']
        const trackedFiles = ['src/file.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toHaveLength(0)
      })
    })
    describe('more complex cases', () => {
      test('filename not at the end of tracked file', () => {
        const sources = [
          'webpack:///./.yarn/cache/testfile.js-npm-1.2.3-abc1234567-abc1234567.zip/node_modules/testfile.js/testfile.js',
        ]
        const trackedFiles = ['.yarn/cache/testfile.js-npm-1.1.1-abc1234567-abc1234567.zip']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toHaveLength(0)
      })
      test('multiple related tracked files from one source', () => {
        const sources = ['webpack:///./src/file.ts']
        const trackedFiles = ['src/file.ts', 'src/commands/sourcemaps/file.ts', 'other']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(['src/file.ts', 'src/commands/sourcemaps/file.ts'])
      })
      test('mix of related and not related', () => {
        const sources = ['folder/file.ts', 'folder/other.ts']
        const trackedFiles = ['src/file.ts', 'file.ts', 'src/other2.ts']
        const matcher = new TrackedFilesMatcher(trackedFiles)
        expect(matcher.matchSources(sources)).toStrictEqual(['src/file.ts', 'file.ts'])
      })
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

      const files = data.trackedFilesMatcher.matchSourcemap(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map'
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
      const files = data.trackedFilesMatcher.matchSourcemap(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map'
      )
      expect(data.remote).toBe('git@github.com:user/other.git')
      expect(data.hash).toBe('25da22df90210a40b919debe3f7ebfb0c1811898')
      expect(files).toStrictEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })
  })
})
