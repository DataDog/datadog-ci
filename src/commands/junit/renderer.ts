import chalk from 'chalk'

import {Payload} from './interfaces'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const jUnitXMLPath = `[${chalk.bold.dim(payload.xmlPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload jUnitXML for ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const jUnitXMLPath = `[${chalk.bold.dim(payload.xmlPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying jUnitXML upload ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (fileCount: number, duration: number) =>
  chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string =>
  `Uploading jUnit XML test report files in ${payload.xmlPath}\n`

export const renderCommandInfo = (basePath: string, service: string, concurrency: number, dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML\n`)
  }
  const startStr = chalk.green(`Starting upload with concurrency ${concurrency}. \n`)
  fullStr += startStr
  const basePathStr = chalk.green(`Will look for jUnit XML files in ${basePath}\n`)
  fullStr += basePathStr
  const serviceVersionProjectPathStr = chalk.green(`service: ${service}\n`)
  fullStr += serviceVersionProjectPathStr

  return fullStr
}
