import {filterTrackedFiles, getRepositoryData, gitRemote, stripCredentials, trackedFileIsRelated} from '../git'

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
      const source = 'webpack:///./src/commands/sourcemaps/__tests__/git.test.ts'
      const trackedFile = 'src/commands/sourcemaps/__tests__/git.test.ts'
      expect(trackedFileIsRelated(source, trackedFile)).toBe(true)
    })
    test('related filename with query parameter', () => {
      const source = 'git.test.ts?abc123'
      const trackedFile = 'src/commands/sourcemaps/__tests__/git.test.ts'
      expect(trackedFileIsRelated(source, trackedFile)).toBe(true)
    })
    test('related hidden file', () => {
      const source = 'folder/.git.test.ts'
      const trackedFile = 'src/commands/sourcemaps/__tests__/.git.test.ts'
      expect(trackedFileIsRelated(source, trackedFile)).toBe(true)
    })
    test('not related', () => {
      const source = 'folder/other.test.ts'
      const trackedFile = 'src/commands/sourcemaps/__tests__/.git.test.ts'
      expect(trackedFileIsRelated(source, trackedFile)).toBe(false)
    })
    test('filename not at the end of tracked file', () => {
      const source = 'webpack:///./.yarn/cache/testfile.js-npm-1.2.3-abc1234567-abc1234567.zip/node_modules/testfile.js/testfile.js'
      const trackedFile = '.yarn/cache/testfile.js-npm-1.1.1-abc1234567-abc1234567.zip'
      expect(trackedFileIsRelated(source, trackedFile)).toBe(false)
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
      const files = await filterTrackedFiles(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
        data.trackedFiles
      )
      expect(data.remote).toBe('git@github.com:user/repository.git')
      expect(data.hash).toBe('25da22df90210a40b919debe3f7ebfb0c1811898')
      expect(files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })

    test('integration: remote override', async () => {
      const stdout = createMockStdout() as any
      const data = await getRepositoryData(createMockSimpleGit() as any, stdout, 'git@github.com:user/other.git')
      if (!data) {
        fail('data should not be undefined')
      }
      const files = await filterTrackedFiles(
        stdout,
        'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
        data.trackedFiles
      )
      expect(data.remote).toBe('git@github.com:user/other.git')
      expect(data.hash).toBe('25da22df90210a40b919debe3f7ebfb0c1811898')
      expect(files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })
  })
})
