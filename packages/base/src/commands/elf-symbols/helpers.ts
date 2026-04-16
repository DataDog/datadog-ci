import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import type {RequestBuilder} from '../../helpers/interfaces'
import type {MultipartPayload, UploadOptions} from '../../helpers/upload'
import {upload} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'

export const getElfRequestBuilder = (apiKey: string, cliVersion: string, site: string) =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_elf-symbols'],
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
