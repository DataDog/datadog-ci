import {getBaseSourcemapIntakeUrl} from '@datadog/datadog-ci-core/helpers/base-intake-url'
import {RequestBuilder} from '@datadog/datadog-ci-core/helpers/interfaces'
import {MultipartPayload, upload, UploadOptions} from '@datadog/datadog-ci-core/helpers/upload'
import {getRequestBuilder} from '@datadog/datadog-ci-core/helpers/utils'

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
