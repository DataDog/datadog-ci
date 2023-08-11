import {newApiKeyValidator} from '../../helpers/apikey'
import {RequestBuilder} from '../../helpers/interfaces'
import {upload, UploadOptions, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder, filterAndFormatGithubRemote} from '../../helpers/utils'
import {version} from '../../helpers/version'

import {getCommitInfo, newSimpleGit} from './git'
import {CommitInfo} from './interfaces'

export const isGitRepo = async (): Promise<boolean> => {
  try {
    const simpleGit = await newSimpleGit()
    const isRepo = simpleGit.checkIsRepo()

    return isRepo
  } catch {
    return false
  }
}

// getGitCommitInfo returns the current [repositoryURL, commitHash]. If parameter
// filterAndFormatGitRepoUrl == true, the repositoryURL will have sensitive information filtered and
// git prefix normalized.
// ("git@github.com:" and "https://github.com/" prefixes will be normalized into "github.com/")
export const getGitCommitInfo = async (filterAndFormatGitRepoUrl = true): Promise<[string, string]> => {
  const simpleGit = await newSimpleGit()
  const payload = await getCommitInfo(simpleGit)

  const gitRemote = filterAndFormatGitRepoUrl ? filterAndFormatGithubRemote(payload.remote) : payload.remote

  // gitRemote will never be undefined, as filterAndFormatGithubRemote will ONLY return undefined if it's
  // parameter value is also undefined. Added the " gitRemote ?? '' " to make the typechecker happy.
  return [gitRemote ?? '', payload.hash]
}

// UploadGitCommitHash uploads local git metadata and returns the current [repositoryURL, commitHash].
// The current repositoryURL can be overridden by specifying the 'repositoryURL' arg.
export const uploadGitCommitHash = async (
  apiKey: string,
  datadogSite: string,
  repositoryURL?: string
): Promise<[string, string]> => {
  const apiKeyValidator = newApiKeyValidator({
    apiKey,
    datadogSite,
  })

  const simpleGit = await newSimpleGit()
  const payload = await getCommitInfo(simpleGit, repositoryURL)

  const requestBuilder = getRequestBuilder({
    apiKey,
    baseUrl: 'https://sourcemap-intake.' + datadogSite,
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci sci'],
      ['DD-EVP-ORIGIN-VERSION', version],
    ]),
    overrideUrl: 'api/v2/srcmap',
  })

  const status = await uploadRepository(requestBuilder, version)(payload, {
    apiKeyValidator,
    onError: (e) => {
      throw e
    },
    onRetry: () => {
      // Do nothing
    },
    onUpload: () => {
      return
    },
    retries: 5,
  })

  if (status !== UploadStatus.Success) {
    throw new Error('Error uploading commit information.')
  }

  return [payload.remote, payload.hash]
}

export const uploadRepository = (
  requestBuilder: RequestBuilder,
  libraryVersion: string
): ((commitInfo: CommitInfo, opts: UploadOptions) => Promise<UploadStatus>) => async (
  commitInfo: CommitInfo,
  opts: UploadOptions
) => {
  const payload = commitInfo.asMultipartPayload(libraryVersion)

  return upload(requestBuilder)(payload, opts)
}
