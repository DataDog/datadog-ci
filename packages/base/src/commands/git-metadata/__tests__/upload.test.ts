import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import {UploadStatus} from '../../../helpers/upload'

import * as gitdbModule from '../gitdb'
import * as libraryModule from '../library'
import {GitMetadataUploadCommand} from '../upload'

describe('execute', () => {
  const runCLI = makeRunCLI(GitMetadataUploadCommand, ['git-metadata', 'upload', '--dry-run'])
  let mockUploadToGitDB: jest.SpyInstance
  let mockUploadRepository: jest.SpyInstance

  beforeEach(() => {
    mockUploadToGitDB = jest.spyOn(gitdbModule, 'uploadToGitDB').mockResolvedValue(undefined)
    mockUploadRepository = jest
      .spyOn(libraryModule, 'uploadRepository')
      .mockReturnValue(jest.fn(() => Promise.resolve(UploadStatus.Success)))
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('runCLI', async () => {
    const {code, context} = await runCLI([], {DATADOG_API_KEY: 'PLACEHOLDER'})
    const output = context.stdout.toString().split('\n')
    output.reverse()
    expect(output[1]).toContain('[DRYRUN] Handled')
    expect(code).toBe(0)

    expect(mockUploadToGitDB).toHaveBeenCalledTimes(1)

    const [logger, requestBuilder, simpleGit, dryRun, repositoryURL] = mockUploadToGitDB.mock.calls[0]
    expect(logger).toBeDefined()
    expect(requestBuilder).toBeDefined()
    expect(simpleGit).toBeDefined()
    expect(dryRun).toBe(true)
    expect(repositoryURL).toBeUndefined()

    expect(mockUploadRepository).not.toHaveBeenCalled()
  })

  test('runCLI without api key', async () => {
    const {code, context} = await runCLI([], {DATADOG_API_KEY: ''})
    const output = context.stdout.toString().split('\n')
    output.reverse()
    expect(output[1]).toContain('Missing DD_API_KEY in your environment')
    expect(code).toBe(1)

    expect(mockUploadToGitDB).not.toHaveBeenCalled()
    expect(mockUploadRepository).not.toHaveBeenCalled()
  })
})
