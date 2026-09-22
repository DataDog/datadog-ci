import {getApiUrl} from '@datadog/datadog-ci-base/helpers/api'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

// The check_exists endpoint accepts at most 1000 debug IDs per request.
const MAX_DEBUG_IDS_PER_REQUEST = 1000

interface CheckExistsResponse {
  data?: {
    attributes?: {
      results?: Record<string, boolean>
    }
  }
}

/**
 * Query the sourcemap-admin check_exists endpoint for the debug IDs that already
 * exist in Datadog. Returns a map of debug ID to existence. Throws on request
 * failure or malformed response — callers should fail open and upload everything.
 */
export const checkExistingDebugIds = async (
  apiKey: string,
  datadogSite: string,
  cliVersion: string,
  debugIds: string[]
): Promise<Record<string, boolean>> => {
  const uniqueIds = [...new Set(debugIds)]
  const results: Record<string, boolean> = {}
  if (uniqueIds.length === 0) {
    return results
  }

  const requestBuilder = getRequestBuilder({
    apiKey,
    baseUrl: getApiUrl(datadogSite),
    headers: new Map([
      ['DD-EVP-ORIGIN', 'datadog-ci_sourcemaps'],
      ['DD-EVP-ORIGIN-VERSION', cliVersion],
    ]),
  })

  for (let i = 0; i < uniqueIds.length; i += MAX_DEBUG_IDS_PER_REQUEST) {
    const chunk = uniqueIds.slice(i, i + MAX_DEBUG_IDS_PER_REQUEST)
    const response = await requestBuilder({
      method: 'POST',
      url: datadogRoute('/api/v2/sourcemaps/check_exists'),
      data: {debug_ids: chunk},
    })
    const chunkResults = (response.data as CheckExistsResponse).data?.attributes?.results
    if (chunkResults === undefined) {
      throw new Error('Invalid check_exists response: missing results')
    }
    Object.assign(results, chunkResults)
  }

  return results
}
