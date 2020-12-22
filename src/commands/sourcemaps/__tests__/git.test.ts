import {stripCredentials, cleanupSource, trackedFilesMap, GitInfos, NewSimpleGit} from '../git'


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
    // projectPath
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
    // hard-coded prefixes
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
    // query parameter
    test('strip projectPath with slashes', () => {
      const source = 'folder1/folder2/src.js?abc123'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
    })
    // all at once
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

      const expected = new Map<string, string>();
      expected.set('folder1/folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folder2/src.js', 'folder1/folder2/src.js')
      expected.set('src.js', 'folder1/folder2/src.js')

      expect(trackedFilesMap(trackedFiles)).toEqual(expected)
    })
    test('two files', () => {
      const trackedFiles = ['folder1/folder2/src.js','folderA/folderB/src.js']

      const expected = new Map<string, string>();
      expected.set('folder1/folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folder2/src.js', 'folder1/folder2/src.js')
      expected.set('folderA/folderB/src.js', 'folderA/folderB/src.js')
      expected.set('folderB/src.js', 'folderA/folderB/src.js')
      expected.set('src.js', 'folderA/folderB/src.js')

      expect(trackedFilesMap(trackedFiles)).toEqual(expected)
    })

    const createMockStdout = () => {
      let data = ''
      return { write: (input: string) => { data += input }, toString: () => data,}
    }

    describe('GitInfos', () => {
    test('integration', async () => {
        const payload = await GitInfos(NewSimpleGit(), createMockStdout() as any, 'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map', '');
        if(!payload) {
          fail('payload should not be undefined')
        }
        expect(payload[0].repository_url).toBe('git@github.com:DataDog/datadog-ci.git')
        expect(payload[0].hash.length).toBe(40)
        expect(payload[0].files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
      })
    })

  test('integration: override repository', async () => {
      const payload = await GitInfos(NewSimpleGit(), createMockStdout() as any, 'src/commands/sourcemaps/__tests__/fixtures/common.min.js.map', 'https://github.com/other/other');
      if(!payload) {
        fail('payload should not be undefined')
      }
      expect(payload.length).toBe(1)
      expect(payload[0].repository_url).toBe('https://github.com/other/other')
      expect(payload[0].hash.length).toBe(40)
      expect(payload[0].files).toEqual(['src/commands/sourcemaps/__tests__/git.test.ts'])
    })
    
  })
})
