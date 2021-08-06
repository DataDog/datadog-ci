import axios from 'axios'
import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import {Writable} from 'stream'

import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'

export const datadogSite = process.env.DATADOG_SITE || 'datadoghq.com'

export const apiHost = 'api.' + datadogSite

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
  }

  return 'https://sourcemap-intake.' + datadogSite
}

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const uploadRepository = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  repository: Payload,
  write: Writable['write']
) => {
  const form = new FormData()
  write(renderUpload)
  form.append('cli_version', repository.cliVersion)
  form.append('type', 'repository')
  form.append('repository', repository.gitRepositoryPayload, {filename: 'repository', contentType: 'application/json'})
  form.append('git_repository_url', repository.gitRepositoryURL)
  form.append('git_commit_sha', repository.gitCommitSha)

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadRepository: uploadRepository(requestIntake),
  }
}

export class ApiKeyValidator {
  private isValid?: boolean

  constructor(public apiKey: string | undefined) {}

  public async isApiKeyValid(): Promise<boolean | undefined> {
    if (this.isValid === undefined) {
      this.isValid = await this.validateApiKey()
    }

    return this.isValid!
  }

  private getApiKeyValidationURL(): string {
    return `https://${apiHost}/api/v1/validate`
  }

  private async validateApiKey(): Promise<boolean> {
    try {
      const response = await axios.get(this.getApiKeyValidationURL(), {
        headers: {
          'DD-API-KEY': this.apiKey,
        },
      })

      return response.data.valid
    } catch (error) {
      if (error.response && error.response.status === 403) {
        return false
      }
      throw error
    }
  }
}
