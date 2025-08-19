/**
 * @file Functions used by `lambda flare` and `cloud-run flare`.
 */

import fs from 'fs'
import {Writable} from 'stream'

import {
  CI_SITE_ENV_VAR,
  DATADOG_SITE_EU1,
  DATADOG_SITE_GOV,
  DATADOG_SITE_US1,
  DATADOG_SITES,
  FLARE_ENDPOINT_PATH,
  SITE_ENV_VAR,
} from '@datadog/datadog-ci-base/constants'
import {post as axiosPost, isAxiosError} from 'axios'
import FormData from 'form-data'
import upath from 'upath'

import {deleteFolder} from './fs'
import * as helpersRenderer from './renderer'
import {isValidDatadogSite} from './validation'
import {getLatestVersion, version} from './version'

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
    await axiosPost(endpointUrl, form, headerConfig)
  } catch (err) {
    // Ensure the root folder is deleted if the request fails
    deleteFolder(rootFolderPath)

    if (isAxiosError(err)) {
      const errResponse: string = (err.response?.data.error as string) ?? ''
      const errorMessage = err.message ?? ''

      let message = `Failed to send flare file to Datadog Support: ${errorMessage}. ${errResponse}\n`
      const code = err.response?.status
      // The error message doesn't say why there was an error. All it says is:
      // "[Error] Failed to send flare file to Datadog Support: Request failed with status code 500."
      // Therefore, we need to add an explanation to clarify when the code is 500 or 403.
      switch (code) {
        case 500:
          message += 'Are your case ID and email correct?\n'
          break
        case 400:
        case 403:
          message += `Is your Datadog API key correct? Please follow this doc to set your API key: 
https://docs.datadoghq.com/serverless/libraries_integrations/cli/#environment-variables\n`
          break
      }

      throw Error(message)
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
export const getProjectFiles = async (projectFiles: string[]) => {
  const filePaths = new Set<string>()
  const cwd = process.cwd()
  for (const fileName of projectFiles) {
    const filePath = upath.join(cwd, fileName)
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
  filePath = fs.existsSync(filePath) ? filePath : upath.join(process.cwd(), filePath)
  if (!fs.existsSync(filePath)) {
    throw Error(helpersRenderer.renderError(`File path '${originalPath}' not found. Please try again.`))
  }

  filePath = upath.resolve(filePath)
  if (projectFilePaths.has(filePath) || additionalFiles.has(filePath)) {
    throw Error(helpersRenderer.renderSoftWarning(`File '${filePath}' has already been added.`))
  }

  return filePath
}

/**
 * Validate the start and end flags and adds error messages if found
 * @param start start time as a string
 * @param end end time as a string
 * @throws error if start or end are not valid numbers
 * @returns [startMillis, endMillis] as numbers or [undefined, undefined] if both are undefined
 */
export const validateStartEndFlags = (start: string | undefined, end: string | undefined) => {
  if (!start && !end) {
    return [undefined, undefined]
  }

  if (!start) {
    throw Error('Start time is required when end time is specified. [--start]')
  }
  if (!end) {
    throw Error('End time is required when start time is specified. [--end]')
  }

  let startMillis = Number(start)
  let endMillis = Number(end)
  if (isNaN(startMillis)) {
    throw Error(`Start time must be a time in milliseconds since Unix Epoch. '${start}' is not a number.`)
  }
  if (isNaN(endMillis)) {
    throw Error(`End time must be a time in milliseconds since Unix Epoch. '${end}' is not a number.`)
  }

  // Required for AWS SDK to work correctly
  startMillis = Math.min(startMillis, Date.now())
  endMillis = Math.min(endMillis, Date.now())

  if (startMillis >= endMillis) {
    throw Error('Start time must be before end time.')
  }

  return [startMillis, endMillis]
}

export const validateCliVersion = async (stdout: Pick<Writable, 'write'>): Promise<void> => {
  try {
    const latestVersion = await getLatestVersion()
    if (latestVersion !== version) {
      stdout.write(
        helpersRenderer.renderSoftWarning(
          `You are using an outdated version of datadog-ci (${version}). The latest version is ${latestVersion}. Please update for better support.`
        )
      )
    }
  } catch {
    // Ignore Errors
  }
}
