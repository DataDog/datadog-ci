import upath from 'upath'

import {validateFilePath, validateJsonStructure, computeFileHash, resolveRepoId} from '../utils'

describe('utils', () => {
  describe('validateFilePath', () => {
    test('returns true for existing file', () => {
      const filePath = upath.join(__dirname, 'fixtures', 'valid-plan.json')
      expect(validateFilePath(filePath)).toBe(true)
    })

    test('returns false for non-existent file', () => {
      const filePath = upath.join(__dirname, 'fixtures', 'does-not-exist.json')
      expect(validateFilePath(filePath)).toBe(false)
    })

    test('returns false for directory', () => {
      const dirPath = upath.join(__dirname, 'fixtures')
      expect(validateFilePath(dirPath)).toBe(false)
    })

    test('returns false for invalid path', () => {
      expect(validateFilePath('/invalid/path/to/file.json')).toBe(false)
    })
  })

  describe('validateJsonStructure', () => {
    test('returns true for valid JSON', () => {
      const validJson = '{"terraform_version":"1.0.0","format_version":"1.0"}'
      expect(validateJsonStructure(validJson)).toBe(true)
    })

    test('returns true for valid JSON object', () => {
      const validJson = '{"key":"value","nested":{"foo":"bar"}}'
      expect(validateJsonStructure(validJson)).toBe(true)
    })

    test('returns true for valid JSON array', () => {
      const validJson = '[{"key":"value"},{"key2":"value2"}]'
      expect(validateJsonStructure(validJson)).toBe(true)
    })

    test('returns true for empty object', () => {
      expect(validateJsonStructure('{}')).toBe(true)
    })

    test('returns false for invalid JSON', () => {
      expect(validateJsonStructure('{invalid json}')).toBe(false)
      expect(validateJsonStructure('{"key":"value"')).toBe(false)
      expect(validateJsonStructure('{"key":}')).toBe(false)
    })

    test('returns false for non-JSON string', () => {
      expect(validateJsonStructure('not json at all')).toBe(false)
      expect(validateJsonStructure('')).toBe(false)
    })
  })

  describe('computeFileHash', () => {
    test('computes SHA256 hash correctly', () => {
      const content = '{"terraform_version":"1.0.0"}'
      const hash = computeFileHash(content)

      // Hash should be a hex string of length 64 (SHA256)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    test('produces different hashes for different content', () => {
      const content1 = '{"version":1}'
      const content2 = '{"version":2}'

      const hash1 = computeFileHash(content1)
      const hash2 = computeFileHash(content2)

      expect(hash1).not.toBe(hash2)
    })

    test('produces same hash for same content', () => {
      const content = '{"terraform_version":"1.0.0","format_version":"1.0"}'

      const hash1 = computeFileHash(content)
      const hash2 = computeFileHash(content)

      expect(hash1).toBe(hash2)
    })

    test('handles empty string', () => {
      const hash = computeFileHash('')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    test('handles large content', () => {
      const largeContent = JSON.stringify({data: 'x'.repeat(100000)})
      const hash = computeFileHash(largeContent)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('resolveRepoId', () => {
    const originalEnv = process.env

    beforeEach(() => {
      jest.resetModules()
      process.env = {...originalEnv}
      delete process.env.DD_GIT_REPOSITORY_URL
      delete process.env.DD_REPOSITORY_URL
    })

    afterAll(() => {
      process.env = originalEnv
    })

    test('returns flag value when provided', () => {
      const flagValue = 'github.com/flag/repo'
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(flagValue, spanTags)

      expect(result).toBe(flagValue)
    })

    test('returns DD_GIT_REPOSITORY_URL when flag not provided', () => {
      process.env.DD_GIT_REPOSITORY_URL = 'github.com/env/repo'
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBe('github.com/env/repo')
    })

    test('returns DD_REPOSITORY_URL when DD_GIT_REPOSITORY_URL not set', () => {
      process.env.DD_REPOSITORY_URL = 'github.com/env2/repo'
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBe('github.com/env2/repo')
    })

    test('returns spanTags value when no flag or env vars', () => {
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBe('https://github.com/span/repo')
    })

    test('returns undefined when no sources available', () => {
      const spanTags = {}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBeUndefined()
    })

    test('prefers flag over env vars', () => {
      const flagValue = 'github.com/flag/repo'
      process.env.DD_GIT_REPOSITORY_URL = 'github.com/env/repo'
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(flagValue, spanTags)

      expect(result).toBe(flagValue)
    })

    test('prefers env var over spanTags', () => {
      process.env.DD_GIT_REPOSITORY_URL = 'github.com/env/repo'
      const spanTags = {'git.repository_url': 'https://github.com/span/repo'}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBe('github.com/env/repo')
    })

    test('prefers DD_GIT_REPOSITORY_URL over DD_REPOSITORY_URL', () => {
      process.env.DD_GIT_REPOSITORY_URL = 'github.com/git/repo'
      process.env.DD_REPOSITORY_URL = 'github.com/repo/url'
      const spanTags = {}

      const result = resolveRepoId(undefined, spanTags)

      expect(result).toBe('github.com/git/repo')
    })
  })
})
