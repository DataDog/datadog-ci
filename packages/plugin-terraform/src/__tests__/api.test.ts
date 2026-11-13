import FormData from 'form-data'

import {uploadTerraformArtifact} from '../api'

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({'content-type': 'multipart/form-data'}),
  }))
})

describe('uploadTerraformArtifact', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates multipart form with event and gzipped file', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'plan' as const,
      filePath: '/path/to/terraform-plan.json',
      fileContent: '{"terraform_version":"1.0.0"}',
      artifactSha256: 'abc123',
      artifactSizeBytes: 1234,
      spanTags: {
        'git.repository_url': 'https://github.com/test/repo',
        'git.commit.sha': 'sha123',
      },
      repoId: 'github.com/test/repo',
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    // Verify event was appended
    expect(appendMock).toHaveBeenCalledWith('event', expect.any(String), {filename: 'event.json'})

    // Verify event contains correct fields
    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson.type).toBe('terraform_artifact')
    expect(eventJson.track_type).toBe('ciiac')
    expect(eventJson.schema_version).toBe('1.0')
    expect(eventJson.artifact_type).toBe('plan')
    expect(eventJson.artifact_format).toBe('terraform-json')
    expect(eventJson.artifact_sha256).toBe('abc123')
    expect(eventJson.artifact_size_bytes).toBe(1234)
    expect(eventJson['git.repository_url']).toBe('https://github.com/test/repo')
    expect(eventJson['git.commit.sha']).toBe('sha123')
    expect(eventJson.repo_id).toBe('github.com/test/repo')

    // Verify file was appended
    expect(appendMock).toHaveBeenCalledWith('iac_file', expect.any(Buffer), {
      filename: 'plan.json.gz',
      contentType: 'application/gzip',
    })

    // Verify request was made
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/v2/ciiac',
        data: formMock,
        headers: formMock.getHeaders(),
      })
    )
  })

  it('creates event for state artifact type', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'state' as const,
      filePath: '/path/to/terraform.tfstate',
      fileContent: '{"version":4}',
      artifactSha256: 'def456',
      artifactSizeBytes: 5678,
      spanTags: {},
      repoId: undefined,
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson.artifact_type).toBe('state')

    // Verify file was appended with state filename
    expect(appendMock).toHaveBeenCalledWith('iac_file', expect.any(Buffer), {
      filename: 'state.json.gz',
      contentType: 'application/gzip',
    })
  })

  it('includes repo_id when provided', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'plan' as const,
      filePath: '/path/to/plan.json',
      fileContent: '{}',
      artifactSha256: 'hash',
      artifactSizeBytes: 100,
      spanTags: {},
      repoId: 'github.com/custom/repo',
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson.repo_id).toBe('github.com/custom/repo')
  })

  it('excludes repo_id when not provided', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'plan' as const,
      filePath: '/path/to/plan.json',
      fileContent: '{}',
      artifactSha256: 'hash',
      artifactSizeBytes: 100,
      spanTags: {},
      repoId: undefined,
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson).not.toHaveProperty('repo_id')
  })

  it('includes all spanTags in event envelope', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'plan' as const,
      filePath: '/path/to/plan.json',
      fileContent: '{}',
      artifactSha256: 'hash',
      artifactSizeBytes: 100,
      spanTags: {
        'git.repository_url': 'https://github.com/test/repo',
        'git.commit.sha': 'abc123',
        'git.branch': 'main',
        'ci.pipeline.id': 'pipeline-42',
        'ci.provider.name': 'github',
      },
      repoId: undefined,
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    const eventCall = appendMock.mock.calls.find((call) => call[0] === 'event')
    const eventJson = JSON.parse(eventCall[1])

    expect(eventJson['git.repository_url']).toBe('https://github.com/test/repo')
    expect(eventJson['git.commit.sha']).toBe('abc123')
    expect(eventJson['git.branch']).toBe('main')
    expect(eventJson['ci.pipeline.id']).toBe('pipeline-42')
    expect(eventJson['ci.provider.name']).toBe('github')
  })

  it('gzips file content before appending', async () => {
    const requestMock = jest.fn().mockResolvedValue({status: 200})

    const appendMock = jest.fn()
    const getHeadersMock = jest.fn().mockReturnValue({'Content-Type': 'multipart/form-data'})
    const formMock = {
      append: appendMock,
      getHeaders: getHeadersMock,
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override constructor
    FormData.mockImplementation(() => formMock)

    const payload = {
      artifactType: 'plan' as const,
      filePath: '/path/to/plan.json',
      fileContent: '{"terraform_version":"1.0.0","some":"data"}',
      artifactSha256: 'hash',
      artifactSizeBytes: 100,
      spanTags: {},
      repoId: undefined,
    }

    const uploader = uploadTerraformArtifact(requestMock)
    await uploader(payload)

    // Find the iac_file call
    const fileCall = appendMock.mock.calls.find((call) => call[0] === 'iac_file')
    const gzippedContent = fileCall[1]

    // Verify it's a Buffer (gzipped data)
    expect(Buffer.isBuffer(gzippedContent)).toBe(true)
    // Gzipped content should be smaller or similar size
    expect(gzippedContent.length).toBeGreaterThan(0)
  })

  describe('expected_plan_count', () => {
    const uploadAndGetEvent = async (expectedPlanCount?: number) => {
      const appendMock = jest.fn()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore override constructor
      FormData.mockImplementation(() => ({append: appendMock, getHeaders: jest.fn().mockReturnValue({})}))

      await uploadTerraformArtifact(jest.fn().mockResolvedValue({status: 200}))({
        artifactType: 'plan',
        filePath: '/path/to/plan.json',
        fileContent: '{}',
        artifactSha256: 'hash',
        artifactSizeBytes: 2,
        spanTags: {},
        expectedPlanCount,
      })

      return JSON.parse(appendMock.mock.calls.find((call) => call[0] === 'event')[1])
    }

    it('includes expected_plan_count when provided', async () => {
      const eventJson = await uploadAndGetEvent(3)

      expect(eventJson.expected_plan_count).toBe(3)
    })

    it('omits expected_plan_count when not provided', async () => {
      const eventJson = await uploadAndGetEvent(undefined)

      expect(eventJson).not.toHaveProperty('expected_plan_count')
    })
  })
})
