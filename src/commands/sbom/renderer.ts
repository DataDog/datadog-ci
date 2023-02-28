import path from 'path'
import chalk from 'chalk'
import {SpanTags} from '../../helpers/interfaces'
import {Payload} from './interfaces'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderInvalidFile = (sbomPath: string, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(sbomPath)}]`
  return chalk.red(`${ICONS.FAILED} Invalid SBOM report file ${reportPath}: ${errorMessage}\n`)
}

export const renderFailedUpload = (sbomPayload: Payload, errorMessage: string) => {
  const reportPath = `[${chalk.bold.dim(sbomPayload.reportPath)}]`
  return chalk.red(`${ICONS.FAILED} Failed upload SBOM report file ${reportPath}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (sbomPayload: Payload, errorMessage: string, attempt: number) => {
  const reportPath = `[${chalk.bold.dim(sbomPayload.reportPath)}]`
  return chalk.yellow(`[attempt ${attempt}] Retrying SBOM report upload ${reportPath}: ${errorMessage}\n`)
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

export const renderUpload = (payload: Payload): string => `Uploading SBOM report in ${payload.reportPath}\n`

export const renderCommandInfo = (basePaths: string[], service: string, concurrency: number, dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SBOM REPORT\n`)
  }
  fullStr += chalk.green(`Starting upload with concurrency ${concurrency}. \n`)
  if (basePaths.length === 1 && !!path.extname(basePaths[0])) {
    fullStr += chalk.green(`Will upload SBOM report file ${basePaths[0]}\n`)
  } else {
    fullStr += chalk.green(`Will look for SBOM report files in ${basePaths.join(', ')}\n`)
  }
  fullStr += chalk.green(`service: ${service}\n`)

  return fullStr
}