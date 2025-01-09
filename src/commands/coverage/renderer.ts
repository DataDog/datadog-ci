import path from 'path'

import chalk from 'chalk'

import {SpanTags} from '../../helpers/interfaces'

import { Flush, Payload } from "./interfaces";

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderInvalidFile = (filePath: string, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Invalid coverage report file ${reportPath}: ${errorMessage}\n`)
}

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(payload.path)}]`

  return chalk.red(`${ICONS.FAILED} Upload failed for ${reportPath}: ${errorMessage}\n`)
}

export const renderFailedFlush = (errorMessage: string) => {
  return chalk.red(`${ICONS.FAILED} Flush signal failed: ${errorMessage}\n`)
}

export const renderFailedGitDBSync = (err: any) => {
  return chalk.red.bold(`${ICONS.FAILED} Could not sync git metadata: ${err}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const reportPath = `[${chalk.bold.dim(payload.path)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying coverage report upload ${reportPath}: ${errorMessage}\n`)
}

export const renderRetriedFlush = (errorMessage: string, attempt: number) => {
  return chalk.yellow(`[attempt ${attempt}] Retrying flush signal: ${errorMessage}\n`)
}

export const renderSuccessfulUpload = (dryRun: boolean, fileCount: number, duration: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.`)
}

export const renderSuccessfulFlush = (dryRun: boolean, duration: number) => {
  return chalk.green(
    `${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Sent code coverage flush signal in ${duration} seconds.`
  )
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Synced git metadata in ${elapsed} seconds.`)
}

// TODO add some Datadog links to the output
export const renderSuccessfulUploadCommand = () => {
  let fullStr = ''
  fullStr += chalk.green(
    '=================================================================================================\n'
  )
  fullStr += chalk.green('* Code coverage report(s) upload successful\n')
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

// TODO add some Datadog links to the output
export const renderSuccessfulFlushCommand = () => {
  let fullStr = ''
  fullStr += chalk.green(
    '=================================================================================================\n'
  )
  fullStr += chalk.green('* Code coverage flush successful\n')
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string => `Uploading code coverage report file in ${payload.path}`

export const renderCommandInfo = (basePaths: string[], concurrency: number, dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT\n`)
  }
  fullStr += chalk.green(`Starting upload with concurrency ${concurrency}. \n`)
  if (basePaths.length === 1 && !!path.extname(basePaths[0])) {
    fullStr += chalk.green(`Will upload code coverage report file ${basePaths[0]}\n`)
  } else {
    fullStr += chalk.green(`Will look for code coverage report files in ${basePaths.join(', ')}\n`)
  }

  return fullStr
}

export const renderFlushInfo = (dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT SEND CODE COVERAGE FLUSH SIGNAL\n`)
  }
  fullStr += chalk.green(`Sending code coverage flush signal \n`)

  return fullStr
}
