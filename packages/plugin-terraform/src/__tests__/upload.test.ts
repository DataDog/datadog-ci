import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import * as api from '../api'
import {PluginCommand as TerraformUploadCommand} from '../commands/upload'

jest.mock('@datadog/datadog-ci-base/helpers/id', () => jest.fn())
jest.mock('@datadog/datadog-ci-base/commands/git-metadata/library', () => ({
  isGitRepo: jest.fn().mockResolvedValue(false),
}))
jest.mock('@datadog/datadog-ci-base/commands/git-metadata/git', () => ({
  newSimpleGit: jest.fn(),
}))
jest.mock('@datadog/datadog-ci-base/commands/git-metadata/gitdb', () => ({
  uploadToGitDB: jest.fn(),
}))

describe('upload', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {...originalEnv}
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('execute', () => {
    test('should throw error if API key is undefined', async () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write}, stderr: {write}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']

      const exitCode = await command.execute()

      expect(exitCode).toBe(1)
      expect(write.mock.calls.some((call) => call[0].includes('DD_API_KEY'))).toBe(true)
    })

    test('should reject non-existent file', async () => {
      process.env = {DD_API_KEY: 'test-key'}
      const write = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stderr: {write}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/does-not-exist.json']

      const exitCode = await command.execute()

      expect(exitCode).toBe(1)
      expect(write.mock.calls[0][0]).toContain('File not found or not readable')
    })

    test('should reject invalid JSON file', async () => {
      process.env = {DD_API_KEY: 'test-key'}
      const write = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stderr: {write}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/invalid.json']

      const exitCode = await command.execute()

      expect(exitCode).toBe(1)
      expect(write.mock.calls[0][0]).toContain('Invalid JSON structure')
    })

    test('should accept valid plan file', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const stderr = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}, stderr: {write: stderr}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['dryRun'] = true // Use dry-run to avoid actual upload

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
      expect(stdout.mock.calls.some((call) => call[0].includes('Would upload'))).toBe(true)
    })

    test('should accept valid state file', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const stderr = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}, stderr: {write: stderr}})
      command['artifactType'] = 'state'
      command['filePaths'] = ['src/__tests__/fixtures/valid-state.json']
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
      expect(stdout.mock.calls.some((call) => call[0].includes('Would upload'))).toBe(true)
    })

    test('should upload multiple valid plan files', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const stderr = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}, stderr: {write: stderr}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json', 'src/__tests__/fixtures/valid-plan.json']
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
      // Should see "Would upload" twice
      const uploadCalls = stdout.mock.calls.filter((call) => call[0].includes('Would upload'))
      expect(uploadCalls.length).toBe(2)
    })

    test('should return error if any file upload fails', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const stderr = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}, stderr: {write: stderr}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json', 'src/__tests__/fixtures/does-not-exist.json']
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(1)
      // Should see one successful upload and one error
      expect(stdout.mock.calls.some((call) => call[0].includes('Would upload'))).toBe(true)
      expect(stderr.mock.calls.some((call) => call[0].includes('File not found or not readable'))).toBe(true)
    })

    test('should use repo-id flag when provided', async () => {
      process.env = {DD_API_KEY: 'test-key'}
      const stdout = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['repoId'] = 'github.com/custom/repo'
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
    })

    test('should skip git metadata upload when flag is set', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['skipGitMetadataUpload'] = true
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
      // Should not see git metadata sync message
      expect(stdout.mock.calls.some((call) => call[0].includes('Syncing git metadata'))).toBe(false)
    })

    test('should enable verbose logging when flag is set', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['verbose'] = true
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
    })
  })

  describe('uploadTerraformArtifact', () => {
    test('should compute file hash and size', async () => {
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
      const stdout = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
      // The command should have computed hash and size internally
    })
  })

  describe('getSpanTags', () => {
    test('should merge CI, git, and user-provided tags', async () => {
      process.env = {
        DD_API_KEY: 'test-key',
        DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo',
        DD_GIT_COMMIT_SHA: 'abc123',
      }
      const stdout = jest.fn()
      const command = createCommand(TerraformUploadCommand, {stdout: {write: stdout}})
      command['artifactType'] = 'plan'
      command['filePaths'] = ['src/__tests__/fixtures/valid-plan.json']
      command['dryRun'] = true

      const exitCode = await command.execute()

      expect(exitCode).toBe(0)
    })
  })

  describe('expected plans', () => {
    const runCLI = makeRunCLI(TerraformUploadCommand, ['terraform', 'upload'], {skipResetEnv: true})
    const uploadMock = jest.fn().mockResolvedValue({status: 200})

    beforeEach(() => {
      uploadMock.mockClear()
      jest.spyOn(api, 'apiConstructor').mockReturnValue({uploadTerraformArtifact: uploadMock})
      process.env = {DD_API_KEY: 'test-key', DD_GIT_REPOSITORY_URL: 'https://github.com/test/repo'}
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    const planArgs = ['plan', 'src/__tests__/fixtures/valid-plan.json', '--skip-git-metadata-upload']

    test('should send the --expected-plans flag value in the payload', async () => {
      const {code} = await runCLI([...planArgs, '--expected-plans', '3'])

      expect(code).toBe(0)
      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({expectedPlanCount: 3}))
    })

    test('should send the same value for every uploaded file', async () => {
      const {code} = await runCLI([...planArgs, 'src/__tests__/fixtures/valid-plan.json', '--expected-plans', '2'])

      expect(code).toBe(0)
      expect(uploadMock).toHaveBeenCalledTimes(2)
      for (const [payload] of uploadMock.mock.calls) {
        expect(payload.expectedPlanCount).toBe(2)
      }
    })

    test('should raise the expected plan count to the number of plan files when lower', async () => {
      const {code, context} = await runCLI([
        ...planArgs,
        'src/__tests__/fixtures/valid-plan.json',
        'src/__tests__/fixtures/valid-plan.json',
        '--expected-plans',
        '2',
      ])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain(
        'Expected plan count (2) is lower than the number of plan files provided (3), using 3 instead'
      )
      expect(uploadMock).toHaveBeenCalledTimes(3)
      for (const [payload] of uploadMock.mock.calls) {
        expect(payload).toMatchObject({expectedPlanCount: 3})
      }
    })

    test('should keep the expected plan count when it equals the number of plan files', async () => {
      const {code, context} = await runCLI([
        ...planArgs,
        'src/__tests__/fixtures/valid-plan.json',
        '--expected-plans',
        '2',
      ])

      expect(code).toBe(0)
      expect(context.stdout.toString()).not.toContain('is lower than the number of plan files')
      expect(uploadMock.mock.calls[0][0].expectedPlanCount).toBe(2)
    })

    test('should not set expectedPlanCount when the flag is not set', async () => {
      const {code} = await runCLI(planArgs)

      expect(code).toBe(0)
      expect(uploadMock.mock.calls[0][0].expectedPlanCount).toBeUndefined()
    })

    test.each(['0', '-1', '1.5', 'abc'])('should reject invalid --expected-plans value %p', async (value) => {
      const {code} = await runCLI([...planArgs, `--expected-plans=${value}`])

      expect(code).toBe(1)
      expect(uploadMock).not.toHaveBeenCalled()
    })

    test('should refuse --expected-plans for state uploads', async () => {
      const {code, context} = await runCLI([
        'state',
        'src/__tests__/fixtures/valid-state.json',
        '--skip-git-metadata-upload',
        '--expected-plans',
        '3',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('--expected-plans can only be used with plan uploads')
      expect(uploadMock).not.toHaveBeenCalled()
    })
  })
})
