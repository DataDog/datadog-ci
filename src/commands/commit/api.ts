import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import {Writable} from 'stream'

import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const uploadRepository = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
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
