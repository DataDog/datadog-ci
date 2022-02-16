import {SimpleGit} from 'simple-git'

import * as apikey from '../../../helpers/apikey'
import * as upload from '../../../helpers/upload'
import * as git from '../git'
import {CommitInfo} from '../interfaces'
import {shouldAddSourceCodeIntegration, uploadGitCommitHash} from '../library'

describe('library', () => {
  describe('shouldAddSourceCodeIntegration', () => {
    test('should return false if datadog API key is not set', async () => {
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue({} as SimpleGit)
      await expect(shouldAddSourceCodeIntegration(undefined)).resolves.toEqual(false)
    })

    test('should return false if checkIsRepo fails', async () => {
      const simpleGitClient = {
        checkIsRepo: () => {
          throw Error()
        },
      } as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      await expect(shouldAddSourceCodeIntegration('placeholder')).resolves.toEqual(false)
    })

    test('should return false git is not installed', async () => {
      jest.spyOn(git, 'newSimpleGit').mockImplementation(() => {
        throw new Error('git is not installed')
      })
      await expect(shouldAddSourceCodeIntegration('placeholder')).resolves.toEqual(false)
    })

    test('should return true if datadog API key is set, git is installed, and we are in a repo', async () => {
      const simpleGitClient = {checkIsRepo: () => true} as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      await expect(shouldAddSourceCodeIntegration('placeholder')).resolves.toEqual(true)
    })
  })

  describe('addSourceCodeIntegration', () => {
    test('source code integration fails if simpleGitOrFail throws an exception', async () => {
      jest.spyOn(git, 'newSimpleGit').mockImplementation(() => {
        throw new Error('git is not installed')
      })

      jest.spyOn(apikey, 'newApiKeyValidator').mockReturnValue({} as any)

      await expect(uploadGitCommitHash('dummy', 'fake.site', 'version')).rejects.toThrowError('git is not installed')
    })

    test('source code integration returns the correct hash', async () => {
      const simpleGitClient = {checkIsRepo: () => true} as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      jest.spyOn(git, 'getCommitInfo').mockImplementation(async () => new CommitInfo('hash', 'url', ['file1', 'file2']))
      jest.spyOn(upload, 'upload').mockReturnValue((a, b) => {
        {
          return new Promise<upload.UploadStatus>((resolve) => {
            resolve(upload.UploadStatus.Success)
          })
        }
      })

      jest.spyOn(apikey, 'newApiKeyValidator').mockReturnValue({} as any)

      expect(await uploadGitCommitHash('dummy', 'fake.site', 'version')).toBe('hash')
    })
  })
})
