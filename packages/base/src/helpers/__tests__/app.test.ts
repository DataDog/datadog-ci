import {getCommonAppBaseURL, getTestRunsUrlPath} from '../app'
import {SpanTags} from '../interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL} from '../tags'

describe('getCommonAppBaseUrl', () => {
  test('the base URL that is correct', () => {
    // Usual datadog site.
    expect(getCommonAppBaseURL('datadoghq.com', '')).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseURL('datadoghq.com', 'app')).toBe('https://app.datadoghq.com/')
    expect(getCommonAppBaseURL('datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')

    // Other datadog site.
    expect(getCommonAppBaseURL('dd.datad0g.com', '')).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseURL('dd.datad0g.com', 'dd')).toBe('https://dd.datad0g.com/')
    expect(getCommonAppBaseURL('dd.datad0g.com', 'myorg')).toBe('https://myorg.datad0g.com/')

    // Different top-level domain.
    expect(getCommonAppBaseURL('datadoghq.eu', '')).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseURL('datadoghq.eu', 'app')).toBe('https://app.datadoghq.eu/')
    expect(getCommonAppBaseURL('datadoghq.eu', 'myorg')).toBe('https://myorg.datadoghq.eu/')

    // AP1/US3/US5-type datadog site: the datadog site's subdomain is replaced by `subdomain` when `subdomain` is custom.
    // The correct Main DC (US3 in this case) is resolved automatically.
    expect(getCommonAppBaseURL('ap1.datadoghq.com', '')).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseURL('ap1.datadoghq.com', 'app')).toBe('https://ap1.datadoghq.com/')
    expect(getCommonAppBaseURL('ap1.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', '')).toBe('https://ap2.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', 'app')).toBe('https://ap2.datadoghq.com/')
    expect(getCommonAppBaseURL('ap2.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', '')).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', 'app')).toBe('https://us3.datadoghq.com/')
    expect(getCommonAppBaseURL('us3.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', '')).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', 'app')).toBe('https://us5.datadoghq.com/')
    expect(getCommonAppBaseURL('us5.datadoghq.com', 'myorg')).toBe('https://myorg.datadoghq.com/')
  })
})

describe('getTestRunsUrlPath', () => {
  it('should return empty string when no CI_JOB_URL or CI_PIPELINE_URL', () => {
    const spanTags: SpanTags = {}
    const result = getTestRunsUrlPath(spanTags)
    expect(result).toBe('')
  })

  it('should return path with job URL when CI_JOB_URL is present', () => {
    const spanTags: SpanTags = {
      [CI_JOB_URL]: 'https://ci.example.com/job/123',
    }
    const result = getTestRunsUrlPath(spanTags)
    expect(result).toBe('ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22')
  })

  it('should return path with pipeline URL when CI_PIPELINE_URL is present but no CI_JOB_URL', () => {
    const spanTags: SpanTags = {
      [CI_PIPELINE_URL]: 'https://ci.example.com/pipeline/456',
    }
    const result = getTestRunsUrlPath(spanTags)
    expect(result).toBe(
      'ci/test-runs?query=%20%40ci.pipeline.url%3A%22https%3A%2F%2Fci.example.com%2Fpipeline%2F456%22'
    )
  })

  it('should prefer CI_JOB_URL over CI_PIPELINE_URL when both are present', () => {
    const spanTags: SpanTags = {
      [CI_JOB_URL]: 'https://ci.example.com/job/123',
      [CI_PIPELINE_URL]: 'https://ci.example.com/pipeline/456',
    }
    const result = getTestRunsUrlPath(spanTags)
    expect(result).toBe('ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22')
  })

  it('should include queryPrefix when provided', () => {
    const spanTags: SpanTags = {
      [CI_JOB_URL]: 'https://ci.example.com/job/123',
    }
    const result = getTestRunsUrlPath(spanTags, '@service:my-service')
    expect(result).toBe(
      'ci/test-runs?query=%40service%3Amy-service%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2F123%22'
    )
  })

  it('should handle special characters in URLs', () => {
    const spanTags: SpanTags = {
      [CI_JOB_URL]: 'https://ci.example.com/job/my-job?param=value&other=123',
    }
    const result = getTestRunsUrlPath(spanTags)
    expect(result).toBe(
      'ci/test-runs?query=%20%40ci.job.url%3A%22https%3A%2F%2Fci.example.com%2Fjob%2Fmy-job%3Fparam%3Dvalue%26other%3D123%22'
    )
  })
})
