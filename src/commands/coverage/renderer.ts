import chalk from 'chalk'
import upath from 'upath'

import {SpanTags} from '../../helpers/interfaces'

import {Payload} from './interfaces'
import {getCoverageDetailsUrl} from './utils'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderFileReadError = (filePath: string, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Error while reading report file ${reportPath}: ${errorMessage}\n`)
}

export const renderInvalidFile = (filePath: string, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Invalid coverage report file ${reportPath}: ${errorMessage}\n`)
}

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const payloadDetails = `${chalk.bold.dim(payload.paths)}`

  return chalk.red(`${ICONS.FAILED} Upload failed for ${payloadDetails}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const payloadDetails = `${chalk.bold.dim(payload.paths)}`

  return chalk.yellow(`[attempt ${attempt}] Retrying coverage report upload ${payloadDetails}: ${errorMessage}\n`)
}

export const renderSuccessfulUpload = (dryRun: boolean, fileCount: number, duration: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.`)
}

export const renderSuccessfulUploadCommand = (spanTags: SpanTags) => {
  const coverageDetailsUrl = getCoverageDetailsUrl(spanTags)
  if (coverageDetailsUrl) {
    let fullStr = ''
    fullStr += chalk.green(
      '=================================================================================================\n'
    )
    fullStr += chalk.green(
      '* View detailed coverage report in Datadog (it can take a few minutes to become available)\n'
    )
    fullStr += chalk.green(`* ${coverageDetailsUrl}\n`)
    fullStr += chalk.green(
      '=================================================================================================\n'
    )

    return fullStr
  }

  return ''
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string => {
  if (payload.paths && payload.paths.length) {
    return `Uploading code coverage report file(s) in ${payload.paths}`
  } else {
    return 'No code coverage report paths, doing nothing'
  }
}

export const renderCommandInfo = (basePaths: string[], dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORTS\n`)
  }
  fullStr += chalk.green(`${new Date().toLocaleString()} - Starting upload. \n`)
  if (!!basePaths.length) {
    if (basePaths.length === 1 && !!upath.extname(basePaths[0])) {
      fullStr += chalk.green(`Will upload code coverage report file ${basePaths[0]}`)
    } else {
      fullStr += chalk.green(`Will look for code coverage report files in ${basePaths.join(', ')}`)
    }
  }

  return fullStr
}
