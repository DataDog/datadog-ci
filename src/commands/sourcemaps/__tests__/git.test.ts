import {stripCredentials, cleanupSource, toTrackedFile} from '../git'

describe('git', () => {
  describe('stripCredentials: nothing to remove', () => {
    test('should return the same value', () => {
      const input = 'https://gitlab.com/User/project.git'

      expect(stripCredentials(input)).toBe(input)
    })
  })
  describe('stripCredentials: user:pwd', () => {
    test('should return without credentials', () => {
      const input = 'https://token:[MASKED]@gitlab.com/User/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/User/project.git')
    })
  })
  describe('stripCredentials: token', () => {
    test('should return without credentials', () => {
      const input = 'https://token@gitlab.com/User/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/User/project.git')
    })
  })

  describe('cleanupSource', () => {
    test('no changes', () => {
      const source = 'folder1/folder2/src.js'
      const projectPath = ''

      const expected = 'folder1/folder2/src.js'

      expect(cleanupSource(source, projectPath)).toBe(expected)
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
  })

  describe('toTrackedFile', () => {
    test('no match', () => {
      const source = 'folder1/folder2/src.js'
      const trackedFiles = ['wrong/folder2/src.js']

      const expected = undefined

      expect(toTrackedFile(source, trackedFiles)).toBe(expected)
    })
    test('exact match', () => {
      const source = 'folder1/folder2/src.js'
      const trackedFiles = ['folder1/folder2/src.js']

      const expected = 'folder1/folder2/src.js'
      
      expect(toTrackedFile(source, trackedFiles)).toBe(expected)
    })
  })
})
