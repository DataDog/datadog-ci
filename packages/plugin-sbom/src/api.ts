import type {ScaRequest} from './types'
import type {RequestConfig, RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

import {CONTENT_TYPE_HEADER, CONTENT_TYPE_VALUE_JSON, METHOD_POST} from '@datadog/datadog-ci-base/constants'
import {getBaseUrl} from '@datadog/datadog-ci-base/helpers/app'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

/**
 * Get the function to upload our results to the intake.
 * @param apiKey
 */
export const getApiHelper = (
  apiKey: string,
  appKey: string,
  source?: string
): ((scaRequest: ScaRequest) => Promise<RequestResponse>) => {
  /**
   * function used to marshall and send the data
   * @param request - the request function used to send the request
   */
  const uploadSBomPayload =
    (request: (args: RequestConfig) => Promise<RequestResponse>) => async (scaPayload: ScaRequest) => {
      // Make sure we follow the API signature
      const payload = {
        data: {
          type: 'scarequests',
          attributes: scaPayload,
        },
      }

      return request({
        data: JSON.stringify(payload),
        headers: {
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_VALUE_JSON,
          'DD-EVP-ORIGIN': 'datadog-ci',
          'DD-EVP-ORIGIN-VERSION': '0.0.1',
          'DD-SOURCE': source || 'CI',
        },
        method: METHOD_POST,
        url: datadogRoute('/api/v2/static-analysis-sca/dependencies'),
      })
    }

  const url = getBaseUrl()
  const requestIntake = getRequestBuilder({baseUrl: url, apiKey, appKey})

  return uploadSBomPayload(requestIntake)
}
