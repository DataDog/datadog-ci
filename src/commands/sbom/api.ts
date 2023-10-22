import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {CONTENT_TYPE_HEADER, CONTENT_TYPE_VALUE_PROTOBUF, METHOD_POST} from '../../constants'
import {getRequestBuilder} from '../../helpers/utils'

import {getBaseUrl} from '../junit/utils'

import {API_ENDPOINT, INTAKE_NAME} from './constants'
import {ScaRequest} from './types'

const maxBodyLength = Infinity

/**
 * Get the function to upload our results to the intake.
 * @param apiKey
 */
export const getApiHelper = (apiKey: string): ((scaRequest: ScaRequest) => AxiosPromise<AxiosResponse>) => {
  /**
   * function used to marshall and send the data
   * @param request - the AXIOS element used to send the request
   */
  const uploadSBomPayload = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
    scaPayload: ScaRequest
  ) => {
    // const buffer = SBOMPayload.encode(payload).finish()

    return request({
      data: JSON.stringify(scaPayload),
      headers: {
        [CONTENT_TYPE_HEADER]: CONTENT_TYPE_VALUE_PROTOBUF,
        'DD-EVP-ORIGIN': 'datadog-ci',
        'DD-EVP-ORIGIN-VERSION': '0.0.1',
      },
      maxBodyLength,
      method: METHOD_POST,
      url: API_ENDPOINT,
    })
  }

  // Get the intake name
  const url = getBaseUrl() + 'api/v2/static-analysis-sca/dependencies'
  // Get the AXIOS request/response function
  const requestIntake = getRequestBuilder({baseUrl: url, apiKey})

  return uploadSBomPayload(requestIntake)
}
