import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import {Writable} from 'stream'

import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const uploadSourcemap = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  sourcemap: Payload,
  write: Writable['write']
) => {
  const form = new FormData()
  write(renderUpload(sourcemap))
  form.append('cli_version', sourcemap.cliVersion)
  form.append('service', sourcemap.service)
  form.append('version', sourcemap.version)
  form.append('source_map', fs.createReadStream(sourcemap.sourcemapPath))
  form.append('minified_file', fs.createReadStream(sourcemap.minifiedFilePath))
  form.append('minified_url', sourcemap.minifiedUrl)
  form.append('project_path', sourcemap.projectPath)
  form.append('type', 'js_sourcemap')
  if (sourcemap.gitRepositoryPayload) {
    form.append('repository', sourcemap.gitRepositoryPayload, {filename: 'repository', contentType: 'application/json'})
  }
  if (sourcemap.gitRepositoryURL) {
    form.append('git_repository_url', sourcemap.gitRepositoryURL)
  }
  if (sourcemap.gitCommitSha) {
    form.append('git_commit_sha', sourcemap.gitCommitSha)
  }

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/srcmap',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadSourcemap: uploadSourcemap(requestIntake),
  }
}
