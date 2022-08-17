import {upload} from '../..//helpers/upload'
import {UploadOptions} from '../..//helpers/upload'
import {getRequestBuilder} from '../..//helpers/utils'
import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import {RequestBuilder} from '../../helpers/interfaces'
import {MultipartPayload} from '../../helpers/upload'

export const getFlutterRequestBuilder = (apiKey: string, cliVersion: string, site: string) =>
  getRequestBuilder({
    apiKey,
    baseUrl: getBaseSourcemapIntakeUrl(site),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci flutter-symbols'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
    overrideUrl: `v1/input/${apiKey}`,
  })

// This function exists partially just to make mocking networkc calls easier.
export const uploadMultipartHelper = async (
  requestBuilder: RequestBuilder,
  payload: MultipartPayload,
  opts: UploadOptions
) => upload(requestBuilder)(payload, opts)
