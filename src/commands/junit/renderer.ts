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
