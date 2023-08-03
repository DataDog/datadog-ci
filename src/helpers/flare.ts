/**
 * @file Functions used by `lambda flare` and `cloud-run flare`.
 */

import fs from 'fs'
import path from 'path'

import axios from 'axios'
import FormData from 'form-data'

import {PROJECT_FILES} from '../commands/lambda/constants'
import {
  CI_SITE_ENV_VAR,
  DATADOG_SITE_EU1,
  DATADOG_SITE_GOV,
  DATADOG_SITE_US1,
  DATADOG_SITES,
  FLARE_ENDPOINT_PATH,
  SITE_ENV_VAR,
} from '../constants'

import {deleteFolder} from './fs'
import * as helpersRenderer from './renderer'
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

/**
 * Searches current directory for project files
 * @returns a set of file paths of project files
 */
export const getProjectFiles = async () => {
  const filePaths = new Set<string>()
  const cwd = process.cwd()
  for (const fileName of PROJECT_FILES) {
    const filePath = path.join(cwd, fileName)
    if (fs.existsSync(filePath)) {
      filePaths.add(filePath)
    }
  }

  return filePaths
}

/**
 * Validates a path to a file
 * @param filePath path to the file
 * @param projectFilePaths map of file names to file paths
 * @param additionalFiles set of additional file paths
 * @throws Error if the file path is invalid or the file was already added
 * @returns the full path to the file
 */
export const validateFilePath = (filePath: string, projectFilePaths: Set<string>, additionalFiles: Set<string>) => {
  const originalPath = filePath
  filePath = fs.existsSync(filePath) ? filePath : path.join(process.cwd(), filePath)
  if (!fs.existsSync(filePath)) {
    throw Error(helpersRenderer.renderError(`File path '${originalPath}' not found. Please try again.`))
  }

  filePath = path.resolve(filePath)
  if (projectFilePaths.has(filePath) || additionalFiles.has(filePath)) {
    throw Error(helpersRenderer.renderSoftWarning(`File '${filePath}' has already been added.`))
  }

  return filePath
}
