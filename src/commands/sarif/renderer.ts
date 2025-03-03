import path from 'path'

import chalk from 'chalk'

import {getBaseUrl} from '../junit/utils'

import {Payload} from './interfaces'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export const renderInvalidFile = (sarifReport: string, errorMessages: string[]) => {
  let fullStr = ''
  const reportPath = `[${chalk.bold.dim(sarifReport)}]`

  fullStr += chalk.red(`${ICONS.FAILED} Invalid SARIF report file ${reportPath}.\n`)
  fullStr += chalk.red(
    `The report is too large, not a valid JSON or is not compliant with the SARIF json schema v2.1.0.\n`
  )

  fullStr += chalk.red(`Error(s) found:\n`)
  for (const errorMessage of errorMessages) {
    fullStr += chalk.red(` - ${errorMessage}\n`)
  }

  return fullStr
}

export const renderMissingTags = (missingTags: string[]) => {
  const styledPath = `[${chalk.bold.dim(process.cwd())}]`

  let fullStr = ''
  fullStr += chalk.red(`There are missing git tags in ${styledPath}:\n`)
  missingTags.forEach((tag: string) => {
    fullStr += chalk.red(` - ${tag}\n`)
  })
  fullStr += chalk.red(`To fix this, ensure that the git information above is available for your commit.\n`)

  return fullStr
}

export const renderFailedUpload = (sarifReport: Payload, error: any) => {
  const reportPath = `[${chalk.bold.dim(sarifReport.reportPath)}]`

  let fullStr = ''
  fullStr += chalk.red(`${ICONS.FAILED} Failed upload SARIF report file ${reportPath}: ${error.message}\n`)
  if (error?.response?.status) {
    fullStr += chalk.red(`API status code: ${error.response.status}\n`)
  }

  return fullStr
}

export const renderRetriedUpload = (sarifReport: Payload, errorMessage: string, attempt: number) => {
  const sarifReportPath = `[${chalk.bold.dim(sarifReport.reportPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying SARIF report upload ${sarifReportPath}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (fileCount: number, duration: number) => {
  let fullStr = ''
  fullStr += chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)
  fullStr += chalk.green(`${ICONS.INFO}  Results available on ${getBaseUrl()}ci/code-analysis\n`)
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUploadWithSpan(payload)}`

export const renderUpload = (payload: Payload): string => `Uploading SARIF report in ${payload.reportPath}\n`
export const renderUploadWithSpan = (payload: Payload): string =>
  `Uploading SARIF report to ${payload.reportPath} with tags ${JSON.stringify(payload.spanTags)}\n`

export const renderCommandInfo = (
  basePaths: string[],
  env: string,
  sha: string,
  concurrency: number,
  dryRun: boolean,
  noVerify: boolean
) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SARIF REPORT\n`)
  }
  if (noVerify) {
    fullStr += chalk.yellow(
      `${ICONS.INFO} --no-verify enabled. The reports will be uploaded without client validation.\n`
    )
  }
  fullStr += chalk.green(`Starting upload with concurrency ${concurrency}. \n`)
  if (basePaths.length === 1 && !!path.extname(basePaths[0])) {
    fullStr += chalk.green(`Will upload SARIF report file ${basePaths[0]}\n`)
  } else {
    fullStr += chalk.green(`Will look for SARIF report files in ${basePaths.join(', ')}\n`)
  }
  fullStr += `Only one upload per commit, env and tool\n`
  fullStr += `Preparing upload for sha:${sha} env:${env}\n`

  return fullStr
}

export const renderFilesNotFound = (basePaths: string[]) => {
  let fullStr = ''
  const paths = basePaths.length === 1 && !!path.extname(basePaths[0]) ? basePaths[0] : basePaths.join(', ')

  fullStr += chalk.yellow(`${ICONS.WARNING} Cannot find valid SARIF report files to upload in ${paths}.\n`)
  fullStr += chalk.yellow(`Check the files exist and are valid.\n`)

  return fullStr
}
