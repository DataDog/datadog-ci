import {newApiKeyValidator} from '../../helpers/apikey'
import {RequestBuilder} from '../../helpers/interfaces'
import {upload, UploadOptions, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'
import {getCommitInfo, newSimpleGit} from './git'
import {CommitInfo} from './interfaces'

export const shouldAddSourceCodeIntegration = async (apiKey: string | undefined): Promise<boolean> => {
  let simpleGit
  let isRepo
  try {
    simpleGit = await newSimpleGit()
    isRepo = simpleGit.checkIsRepo()
  } catch {
    return false
  }

  // Only enable if the system has `git` installed and we're in a git repo
  return apiKey !== undefined && isRepo
}

export const uploadGitCommitHash = async (apiKey: string, datadogSite: string, version: string): Promise<string> => {
  const apiKeyValidator = newApiKeyValidator({
    apiKey,
    datadogSite,
  })

  const simpleGit = await newSimpleGit()
  const payload = await getCommitInfo(simpleGit)

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

  return payload.hash
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
