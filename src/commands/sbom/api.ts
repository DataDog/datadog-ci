import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {CONTENT_TYPE_HEADER, CONTENT_TYPE_VALUE_PROTOBUF, METHOD_POST} from '../../constants'
import {getBaseIntakeUrl} from '../../helpers/api'
import {getRequestBuilder} from '../../helpers/utils'

import {API_ENDPOINT, INTAKE_NAME} from './constants'
import {SBOMPayload} from './protobuf/sbom_intake'

const maxBodyLength = Infinity

/**
 * Get the function to upload our results to the intake.
 * @param apiKey
 */
export const getApiHelper = (apiKey: string): ((sbomPayload: SBOMPayload) => AxiosPromise<AxiosResponse>) => {
  /**
   * function used to marshall and send the data
   * @param request - the AXIOS element used to send the request
   */
  const uploadSBomPayload = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
    payload: SBOMPayload
  ) => {
    const buffer = SBOMPayload.encode(payload).finish()

    return request({
      data: buffer,
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
  const intakeUrl = getBaseIntakeUrl(INTAKE_NAME)
  // Get the AXIOS request/response function
  const requestIntake = getRequestBuilder({baseUrl: intakeUrl, apiKey})

  return uploadSBomPayload(requestIntake)
}
