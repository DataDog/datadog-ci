import {cleanupSource, gitInfos, newSimpleGit, stripCredentials, trackedFilesMap} from '../git'

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

  describe('cleanupSource', () => {
    test('no changes', () => {
      const source = 'folder1/folder2/src.js'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, '')).toBe(expected)
    })
    test('strip relative path', () => {
      const source = '../folder1/folder2/src.js'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, '')).toBe(expected)
    })
    // ProjectPath
    test('strip projectPath', () => {
      const source = 'project/folder1/folder2/src.js'
      const projectPath = 'project'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    test('strip relative projectPath', () => {
      const source = 'project/folder1/folder2/src.js'
      const projectPath = '../project'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    test('strip projectPath with slashes', () => {
      const source = '/project/folder1/folder2/src.js'
      const projectPath = '/project/'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    // Hard-coded prefixes
    test('strip webpack:///./', () => {
      const source = 'webpack:///./folder1/folder2/src.js'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    test('strip webpack:///../', () => {
      const source = 'webpack:///../folder1/folder2/src.js'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    test('strip webpack:////', () => {
      const source = 'webpack:////folder1/folder2/src.js'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    // Query parameter
    test('strip projectPath with slashes', () => {
      const source = 'folder1/folder2/src.js?abc123'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    // All at once
    test('all at once', () => {
      const source = 'webpack:///./project/folder1/folder2/src.js?abc123'
      const projectPath = 'project/'

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
  })

  describe('trackedFilesMap', () => {
    test('one file', () => {
      const trackedFiles = ['folder1/folder2/src.js']

      const expected = new Map<string, string>()
      expected.set('folder1/folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folder2/src.js', 'folder1/folder2/src.js')
      expected.set('src.js', 'folder1/folder2/src.js')

      expect(trackedFilesMap(trackedFiles)).toEqual(expected)
    })
    test('two files', () => {
      const trackedFiles = ['folder1/folder2/src.js', 'folderA/folderB/src.js']

      const expected = new Map<string, string>()
      expected.set('folder1/folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folderA/folderB/src.js', 'folderA/folderB/src.js')
      expected.set('folderB/src.js', 'folderA/folderB/src.js')
      expected.set('src.js', 'folderA/folderB/src.js')

      expect(trackedFilesMap(trackedFiles)).toEqual(expected)
    })

    const createMockStdout = () => {
      let data = ''

      return {
        toString: () => data,
        write: (input: string) => {
          data += input
        },
      }
    }

    const createMockSimpleGit = () => {
      return {
        getRemotes: (arg: boolean) => [{refs: {push: "git@github.com:user/repository.git" }}],
        revparse: (arg: string) => "25da22df90210a40b919debe3f7ebfb0c1811898",
        raw: (arg: string) => "src/commands/sourcemaps/__tests__/git.test.ts",
      }
    }

    describe('GitInfos', () => {
      test('integration', async () => {
        const payload = await gitInfos(
          createMockSimpleGit() as any,
          createMockStdout() as any,
          'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
          ''
        )
        if (!payload) {
          fail('payload should not be undefined')
        }
        expect(payload[0].repository_url).toBe('git@github.com:user/repository.git')
        expect(payload[0].hash).toBe("25da22df90210a40b919debe3f7ebfb0c1811898")
        expect(payload[0].files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
      })

      test('integration: url override', async () => {
        const payload = await gitInfos(
          createMockSimpleGit() as any,
          createMockStdout() as any,
          'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map',
          'git@github.com:user/other.git'
        )
        if (!payload) {
          fail('payload should not be undefined')
        }
        expect(payload[0].repository_url).toBe('git@github.com:user/other.git')
        expect(payload[0].hash).toBe("25da22df90210a40b919debe3f7ebfb0c1811898")
        expect(payload[0].files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
      })
    })
  })
})
