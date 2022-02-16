import {newApiKeyValidator} from '../../helpers/apikey'
import {RequestBuilder} from '../../helpers/interfaces'
import {upload, UploadOptions, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'
import {getCommitInfoBasic, newSimpleGitOrFail} from './git'
import {CommitInfo} from './interfaces'

export class SourceCodeIntegration {
  private apiKey: string
  private datadogSite: string
  private version = require('../../../package.json').version

  constructor(apiKey: string, datadogSite?: string) {
    this.datadogSite = datadogSite ?? 'datadoghq.com'
    this.apiKey = apiKey
  }

  public static async shouldAddSourceCodeIntegration(apiKey: string | undefined): Promise<boolean> {
    let simpleGit
    let isRepo
    try {
      simpleGit = await newSimpleGitOrFail()
      isRepo = simpleGit.checkIsRepo()
    } catch {
      return false
    }

    // Only enable if the system has `git` installed and we're in a git repo
    return apiKey !== undefined && isRepo
  }

  public async uploadGitCommitHash(): Promise<string> {
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.apiKey,
      datadogSite: this.datadogSite,
    })

    try {
      const simpleGit = await newSimpleGitOrFail()
      const payload = await getCommitInfoBasic(simpleGit)

      const requestBuilder = getRequestBuilder({
        apiKey: this.apiKey!,
        baseUrl: 'https://sourcemap-intake.' + this.datadogSite,
        headers: new Map([
          ['DD-EVP-ORIGIN', 'datadog-ci sci'],
          ['DD-EVP-ORIGIN-VERSION', this.version],
        ]),
        overrideUrl: 'api/v2/srcmap',
      })

      const status = await this.uploadRepository(requestBuilder)(payload, {
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
    } catch (error) {
      throw error
    }
  }

  private uploadRepository(
    requestBuilder: RequestBuilder
  ): (commitInfo: CommitInfo, opts: UploadOptions) => Promise<UploadStatus> {
    return async (commitInfo: CommitInfo, opts: UploadOptions) => {
      const payload = commitInfo.asMultipartPayload(this.version)

      return upload(requestBuilder)(payload, opts)
    }
  }
}
