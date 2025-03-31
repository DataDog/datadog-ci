import * as path from 'path'

import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import {RequestBuilder} from '../../helpers/interfaces'
import {MultipartPayload, upload, UploadOptions} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'

export const getFlutterRequestBuilder = (apiKey: string, cliVersion: string, site: string) =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_flutter-symbols'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
    overrideUrl: 'api/v2/srcmap',
  })

// This function exists partially just to make mocking network calls easier.
export const uploadMultipartHelper = async (
  requestBuilder: RequestBuilder,
  payload: MultipartPayload,
  opts: UploadOptions
) => upload(requestBuilder)(payload, opts)

export const getArchInfoFromFilename = (filename: string) => {
  const parsed = path.parse(filename)
  const basename = parsed.name
  const groups = /^.*\.(?<platform>.*)-(?<arch>.*)$/.exec(basename)?.groups
  if (!groups) {
    return undefined
  }

  const value = {
    arch: groups.arch,
    platform: groups.platform,
  }

  if (!value.platform || !value.arch) {
    return undefined
  }

  return value
}
