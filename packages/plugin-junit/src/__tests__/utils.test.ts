import * as appHelpers from '@datadog/datadog-ci-base/helpers/app'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {
  CI_JOB_URL,
  CI_PIPELINE_URL,
  GIT_BRANCH,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '@datadog/datadog-ci-base/helpers/tags'

import {getTestRunsUrl, getTestCommitRedirectURL} from '../utils'

let mockGetBaseUrl: jest.SpyInstance<string>

describe('junit utils', () => {
  beforeEach(() => {
    mockGetBaseUrl = jest.spyOn(appHelpers, 'getBaseUrl')
  })

  describe('getTestRunsUrl', () => {
    it('should return empty string when getTestRunsUrlPath returns empty string', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {}
      const result = getTestRunsUrl(spanTags)
      expect(result).toBe('')
    })

    it('should construct correct URL without double slashes', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [CI_JOB_URL]: 'https://ci.example.com/job/123',
      }
      const result = getTestRunsUrl(spanTags)
      expect(result).toBe(
        'https://app.datadoghq.com/ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22'
      )
      expect(result).not.toContain('//ci/test-runs')
    })

    it('should work with custom site and subdomain', () => {
      mockGetBaseUrl.mockReturnValue('https://myorg.datadoghq.eu/')
      const spanTags: SpanTags = {
        [CI_PIPELINE_URL]: 'https://gitlab.com/project/pipelines/789',
      }
      const result = getTestRunsUrl(spanTags)
      expect(result).toBe(
        'https://myorg.datadoghq.eu/ci/test-runs?query=%20%40ci.pipeline.url%3A%22https%3A%2F%2Fgitlab.com%2Fproject%2Fpipelines%2F789%22'
      )
    })

    it('should include queryPrefix in final URL', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [CI_JOB_URL]: 'https://ci.example.com/job/123',
      }
      const result = getTestRunsUrl(spanTags, '@service:my-service')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/test-runs?query=%40service%3Amy-service%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22'
      )
    })

    it('should handle different base URL formats correctly', () => {
      // Test with base URL that has trailing slash
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [CI_JOB_URL]: 'https://ci.example.com/job/123',
      }
      const result = getTestRunsUrl(spanTags)
      expect(result).toBe(
        'https://app.datadoghq.com/ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22'
      )

      // Verify no double slashes
      expect(result).not.toContain('//ci/')
    })
  })

  describe('getTestCommitRedirectURL', () => {
    it('should return empty string when required fields are missing', () => {
      // Missing GIT_REPOSITORY_URL
      let spanTags: SpanTags = {
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123',
      }
      expect(getTestCommitRedirectURL(spanTags, 'my-service')).toBe('')

      // Missing GIT_BRANCH
      spanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_SHA]: 'abc123',
      }
      expect(getTestCommitRedirectURL(spanTags, 'my-service')).toBe('')

      // Missing GIT_SHA
      spanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
      }
      expect(getTestCommitRedirectURL(spanTags, 'my-service')).toBe('')

      // Missing service
      spanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123',
      }
      expect(getTestCommitRedirectURL(spanTags)).toBe('')
    })

    it('should construct correct redirect URL with all required fields', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Frepo/-/my-service/-/main/-/abc123def456'
      )
    })

    it('should include env parameter when provided', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service', 'staging')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Frepo/-/my-service/-/main/-/abc123def456?env=staging'
      )
    })

    it('should handle special characters in repository URL', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/my-repo.git',
        [GIT_BRANCH]: 'feature/my-feature',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Fmy-repo.git/-/my-service/-/feature%2Fmy-feature/-/abc123def456'
      )
    })

    it('should handle special characters in service name', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service@v1.0')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Frepo/-/my-service%40v1.0/-/main/-/abc123def456'
      )
    })

    it('should handle special characters in branch name', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'feature/my-feature@v1.0',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Frepo/-/my-service/-/feature%2Fmy-feature%40v1.0/-/abc123def456'
      )
    })

    it('should handle special characters in env parameter', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://github.com/user/repo',
        [GIT_BRANCH]: 'main',
        [GIT_SHA]: 'abc123def456',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service', 'staging@v1.0')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fuser%2Frepo/-/my-service/-/main/-/abc123def456?env=staging%40v1.0'
      )
    })

    it('should work with custom site and subdomain', () => {
      mockGetBaseUrl.mockReturnValue('https://myorg.datadoghq.eu/')
      const spanTags: SpanTags = {
        [GIT_REPOSITORY_URL]: 'https://gitlab.com/user/repo',
        [GIT_BRANCH]: 'develop',
        [GIT_SHA]: 'def456abc123',
      }
      const result = getTestCommitRedirectURL(spanTags, 'my-service', 'production')
      expect(result).toBe(
        'https://myorg.datadoghq.eu/ci/redirect/tests/https%3A%2F%2Fgitlab.com%2Fuser%2Frepo/-/my-service/-/develop/-/def456abc123?env=production'
      )
    })
  })

  describe('URL construction edge cases', () => {
    it('should handle empty queryPrefix correctly', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [CI_JOB_URL]: 'https://ci.example.com/job/123',
      }
      const result = getTestRunsUrl(spanTags, '')
      expect(result).toBe(
        'https://app.datadoghq.com/ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22'
      )
    })

    it('should handle extremely long URLs', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const longUrl = 'https://ci.example.com/very/long/path/that/goes/on/and/on/with/many/segments/job/123'
      const spanTags: SpanTags = {
        [CI_JOB_URL]: longUrl,
      }
      const result = getTestRunsUrl(spanTags)
      expect(result).toContain(encodeURIComponent(longUrl))
      expect(result).not.toContain('//ci/test-runs')
    })

    it('should handle URLs with various protocols', () => {
      mockGetBaseUrl.mockReturnValue('https://app.datadoghq.com/')
      const spanTags: SpanTags = {
        [CI_JOB_URL]: 'http://ci.example.com/job/123',
      }
      const result = getTestRunsUrl(spanTags)
      expect(result).toContain('http%3A%2F%2Fci.example.com%2Fjob%2F123')
    })
  })
})
