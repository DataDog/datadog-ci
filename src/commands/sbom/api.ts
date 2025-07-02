import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {CONTENT_TYPE_HEADER, CONTENT_TYPE_VALUE_JSON, METHOD_POST} from '../../constants'
import {getBaseUrl} from '../../helpers/app'
import {getRequestBuilder} from '../../helpers/utils'

import {API_ENDPOINT} from './constants'
import {ScaRequest} from './types'

const maxBodyLength = Infinity

/**
 * Get the function to upload our results to the intake.
 * @param apiKey
 */
export const getApiHelper = (
  apiKey: string,
  appKey: string
): ((scaRequest: ScaRequest) => AxiosPromise<AxiosResponse>) => {
  /**
   * function used to marshall and send the data
   * @param request - the AXIOS element used to send the request
   */
  const uploadSBomPayload = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
    scaPayload: ScaRequest
  ) => {
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
      },
      maxBodyLength,
      method: METHOD_POST,
      url: API_ENDPOINT,
    })
  }

  // Get the intake name
  const url = getBaseUrl()
  // Get the AXIOS request/response function
  const requestIntake = getRequestBuilder({baseUrl: url, apiKey, appKey})

  return uploadSBomPayload(requestIntake)
}
