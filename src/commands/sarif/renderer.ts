import path from 'path'

import chalk from 'chalk'

import {SpanTags} from '../../helpers/interfaces'

import {Payload} from './interfaces'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export const renderInvalidFile = (sarifReport: string, errorMessage: string) => {
  let fullStr = ''
  const reportPath = `[${chalk.bold.dim(sarifReport)}]`

  fullStr += chalk.red(`${ICONS.FAILED} Invalid SARIF report file ${reportPath}.\n`)
  fullStr += chalk.red(`The report is not a valid JSON or is not compliant with the SARIF json schema v2.1.0.\n`)
  fullStr += chalk.red(`Errors: ${errorMessage}\n`)

  return fullStr
}

export const renderFailedUpload = (sarifReport: Payload, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(sarifReport.reportPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload SARIF report file ${reportPath}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (sarifReport: Payload, errorMessage: string, attempt: number) => {
  const sarifReportPath = `[${chalk.bold.dim(sarifReport.reportPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying SARIF report upload ${sarifReportPath}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (
  fileCount: number,
  duration: number,
  spanTags: SpanTags,
  service: string,
  env?: string
) => {
  let fullStr = ''
  fullStr += chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string => `Uploading SARIF report in ${payload.reportPath}\n`

export const renderCommandInfo = (
  basePaths: string[],
  service: string,
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
  fullStr += chalk.green(`service: ${service}\n`)

  return fullStr
}

export const renderFilesNotFound = (basePaths: string[], service: string) => {
  let fullStr = ''
  const paths = basePaths.length === 1 && !!path.extname(basePaths[0]) ? basePaths[0] : basePaths.join(', ')

  fullStr += chalk.yellow(
    `${ICONS.WARNING} Cannot find valid SARIF report files to upload in ${paths} for service ${service}.\n`
  )
  fullStr += chalk.yellow(`Check the files exist and are valid.\n`)

  return fullStr
}
