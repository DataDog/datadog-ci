import * as apikey from '@datadog/datadog-ci-core/helpers/apikey'
import * as upload from '@datadog/datadog-ci-core/helpers/upload'

import * as git from '../git'
import * as gitdb from '../gitdb'
import {CommitInfo} from '../interfaces'
import {isGitRepo, uploadGitCommitHash} from '../library'

describe('library', () => {
  describe('isGitRepo', () => {
    test('should return false if checkIsRepo fails', async () => {
      const simpleGitClient = {
        checkIsRepo: () => {
          throw Error()
        },
      } as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      await expect(isGitRepo()).resolves.toEqual(false)
    })

    test('should return false git is not installed', async () => {
      jest.spyOn(git, 'newSimpleGit').mockImplementation(() => {
        throw new Error('git is not installed')
      })
      await expect(isGitRepo()).resolves.toEqual(false)
    })

    test('should return true if datadog API key is set, git is installed, and we are in a repo', async () => {
      const simpleGitClient = {checkIsRepo: () => true} as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      await expect(isGitRepo()).resolves.toEqual(true)
    })
  })

  describe('addSourceCodeIntegration', () => {
    test('source code integration fails if simpleGitOrFail throws an exception', async () => {
      jest.spyOn(git, 'newSimpleGit').mockImplementation(() => {
        throw new Error('git is not installed')
      })

      jest.spyOn(apikey, 'newApiKeyValidator').mockReturnValue({} as any)

      await expect(uploadGitCommitHash('dummy', 'fake.site')).rejects.toThrow('git is not installed')
    })

    test('source code integration returns the correct hash and url', async () => {
      const simpleGitClient = {checkIsRepo: () => true} as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      jest.spyOn(git, 'getCommitInfo').mockImplementation(async (_, repositoryURL) => {
        expect(repositoryURL).toEqual(undefined)

        return new CommitInfo('hash', 'url', ['file1', 'file2'])
      })
      jest.spyOn(gitdb, 'uploadToGitDB').mockImplementation((log, req, simplegit, dryRun, repositoryURL) => {
        expect(repositoryURL).toEqual('url')
        expect(dryRun).toBe(false)

        return Promise.resolve()
      })
      jest.spyOn(upload, 'upload').mockReturnValue((a, b) => {
        {
          return new Promise<upload.UploadStatus>((resolve) => {
            resolve(upload.UploadStatus.Success)
          })
        }
      })

      jest.spyOn(apikey, 'newApiKeyValidator').mockReturnValue({} as any)

      expect(await uploadGitCommitHash('dummy', 'fake.site')).toEqual(['url', 'hash'])
    })

    test('source code integration returns the correct hash and overriden url', async () => {
      const simpleGitClient = {checkIsRepo: () => true} as any
      jest.spyOn(git, 'newSimpleGit').mockResolvedValue(simpleGitClient)

      jest.spyOn(git, 'getCommitInfo').mockImplementation(async (_, repositoryURL) => {
        expect(repositoryURL).toEqual('customUrl')

        return new CommitInfo('hash', 'customUrl', ['file1', 'file2'])
      })
      jest.spyOn(gitdb, 'uploadToGitDB').mockImplementation((log, req, simplegit, dryRun, repositoryURL) => {
        expect(repositoryURL).toEqual('customUrl')
        expect(dryRun).toBe(false)

        return Promise.resolve()
      })
      jest.spyOn(upload, 'upload').mockReturnValue((a, b) => {
        {
          return new Promise<upload.UploadStatus>((resolve) => {
            resolve(upload.UploadStatus.Success)
          })
        }
      })

      jest.spyOn(apikey, 'newApiKeyValidator').mockReturnValue({} as any)

      expect(await uploadGitCommitHash('dummy', 'fake.site', 'customUrl')).toEqual(['customUrl', 'hash'])
    })
  })
})
