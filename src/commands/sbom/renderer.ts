import chalk from 'chalk'

import {getBaseUrl} from '../junit/utils'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export const renderInvalidFile = (sbomReport: string) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`

  let fullStr = ''
  fullStr += chalk.red(`${ICONS.FAILED} Invalid SBOM report file ${reportPath}.\n`)
  fullStr += chalk.red(`The report is not a valid SBOM or is not compliant with our json schema.\n`)

  return fullStr
}

export const renderInvalidPayload = (sbomReport: string) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`

  return chalk.red(`Cannot generate payload for file ${reportPath}.\n`)
}

export const renderMissingSpan = (errorMessage: string) => {
  const currentPath = `[${chalk.bold.dim(process.cwd())}]`

  let fullStr = ''
  fullStr += chalk.yellow(`${ICONS.WARNING}  Validation failed: ${errorMessage}.\n`)
  fullStr += chalk.yellow(
    `Upload attempted from ${currentPath}. Is this the directory for which this analysis was run?\n`
  )
  fullStr += chalk.yellow(`The upload must come from a directory with a ".git" directory.\n`)

  return fullStr
}

export const renderDuplicateUpload = (sha: string, env: string, service: string) => {
  let fullStr = ''
  fullStr += chalk.red(`${ICONS.WARNING}  Duplicate SBOM upload detected\n`)
  fullStr += chalk.red(`An analysis has already been processed for sha:${sha} env:${env} service:${service}\n`)
  fullStr += chalk.red(`Push a new commit or specify a different env or service variable\n`)
  fullStr += chalk.red(`Exiting with code 0\n`)

  return fullStr
}

export const renderFailedUpload = (sbomReport: string, error: any) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`

  let fullStr = ''
  fullStr += chalk.red(`${ICONS.FAILED}  Failed upload SBOM file ${reportPath}: ${error.message}\n`)
  if (error?.response?.status) {
    fullStr += chalk.red(`API status code: ${error.response.status}\n`)
  }

  return fullStr
}

export const renderUploading = (sbomReport: string): string => `Uploading SBOM report in ${sbomReport}\n`

export const renderSuccessfulCommand = (fileCount: number, duration: number) => {
  let fullStr = ''
  fullStr += chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)
  fullStr += chalk.green(`${ICONS.INFO}  Results available on ${getBaseUrl()}ci/code-analysis\n`)
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}
