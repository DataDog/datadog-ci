import {stripCredentials} from '../git'

describe('utils', () => {
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
})
