import fs from 'fs'

import axios from 'axios'
import FormData from 'form-data'

import {
  CI_SITE_ENV_VAR,
  DATADOG_SITE_EU1,
  DATADOG_SITE_GOV,
  DATADOG_SITE_US1,
  DATADOG_SITES,
  FLARE_ENDPOINT_PATH,
  SITE_ENV_VAR,
} from '../constants'

import {deleteFolder} from './fileSystem'
import {isValidDatadogSite} from './validation'

const {version} = require('../../package.json')

/**
 * Send the zip file to Datadog support
 * @param zipPath
 * @param caseId
 * @param email
 * @param apiKey
 * @param rootFolderPath
 * @throws Error if the request fails
 */
export const sendToDatadog = async (
  zipPath: string,
  caseId: string,
  email: string,
  apiKey: string,
  rootFolderPath: string
) => {
  const endpointUrl = getEndpointUrl()
  const form = new FormData()
  form.append('case_id', caseId)
  form.append('flare_file', fs.createReadStream(zipPath))
  form.append('datadog_ci_version', version)
  form.append('email', email)
  const headerConfig = {
    headers: {
      ...form.getHeaders(),
      'DD-API-KEY': apiKey,
    },
  }

  try {
    await axios.post(endpointUrl, form, headerConfig)
  } catch (err) {
    // Ensure the root folder is deleted if the request fails
    deleteFolder(rootFolderPath)

    if (axios.isAxiosError(err)) {
      const errResponse: string = (err.response?.data.error as string) ?? ''
      const errorMessage = err.message ?? ''

      throw Error(`Failed to send flare file to Datadog Support: ${errorMessage}. ${errResponse}\n`)
    }

    throw err
  }
}

/**
 * Calculates the full endpoint URL
 * @throws Error if the site is invalid
 * @returns the full endpoint URL
 */
export const getEndpointUrl = () => {
  const baseUrl = process.env[CI_SITE_ENV_VAR] ?? process.env[SITE_ENV_VAR] ?? DATADOG_SITE_US1
  // The DNS doesn't redirect to the proper endpoint when a subdomain is not present in the baseUrl.
  // There is a DNS inconsistency
  let endpointUrl = baseUrl
  if ([DATADOG_SITE_US1, DATADOG_SITE_EU1, DATADOG_SITE_GOV].includes(baseUrl)) {
    endpointUrl = 'app.' + baseUrl
  }

  if (!isValidDatadogSite(baseUrl)) {
    throw Error(`Invalid site: ${baseUrl}. Must be one of: ${DATADOG_SITES.join(', ')}`)
  }

  return 'https://' + endpointUrl + FLARE_ENDPOINT_PATH
}
