import {getBaseSourcemapIntakeUrl} from '@datadog/datadog-ci-base/helpers/base-intake-url'
import {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'
import {MultipartPayload, upload, UploadOptions} from '@datadog/datadog-ci-base/helpers/upload'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

export const getPERequestBuilder = (apiKey: string, cliVersion: string, site: string) =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_pe-symbols'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
    overrideUrl: 'api/v2/srcmap',
  })

// TODO: this is an exact duplicate of elf-symbols --> should we share the implementation in a more shared helper.ts file?
// This function exists partially just to make mocking network calls easier.
export const uploadMultipartHelper = async (
  requestBuilder: RequestBuilder,
  payload: MultipartPayload,
  opts: UploadOptions
) => upload(requestBuilder)(payload, opts)
