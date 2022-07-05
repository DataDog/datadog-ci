import chalk from 'chalk'
import path from 'path'

import {SpanTags} from '../../helpers/interfaces'
import {Payload} from './interfaces'
import {getTestRunsUrl} from './utils'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderInvalidFile = (xmlPath: string, errorMessage: string) => {
  const jUnitXMLPath = `[${chalk.bold.dim(xmlPath)}]`

  return chalk.red(`${ICONS.FAILED} Invalid jUnitXML file ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const jUnitXMLPath = `[${chalk.bold.dim(payload.xmlPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload jUnitXML for ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const jUnitXMLPath = `[${chalk.bold.dim(payload.xmlPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying jUnitXML upload ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (fileCount: number, duration: number, spanTags: SpanTags) => {
  let fullStr = ''
  fullStr += chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)

  const testRunsUrl = getTestRunsUrl(spanTags)
  if (testRunsUrl) {
    fullStr += chalk.green(
      '=================================================================================================\n'
    )
    fullStr += chalk.green(
      '* View test runs and detailed time reports on Datadog (can take a few minutes to become available)\n'
    )
    fullStr += chalk.green(`* ${getTestRunsUrl(spanTags)}\n`)
    fullStr += chalk.green(
      '=================================================================================================\n'
    )
  }

  return fullStr
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string => `Uploading jUnit XML test report file in ${payload.xmlPath}\n`

export const renderCommandInfo = (basePaths: string[], service: string, concurrency: number, dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML\n`)
  }
  fullStr += chalk.green(`Starting upload with concurrency ${concurrency}. \n`)
  if (basePaths.length === 1 && !!path.extname(basePaths[0])) {
    fullStr += chalk.green(`Will upload jUnit XML file ${basePaths[0]}\n`)
  } else {
    fullStr += chalk.green(`Will look for jUnit XML files in ${basePaths.join(', ')}\n`)
  }
  fullStr += chalk.green(`service: ${service}\n`)

  return fullStr
}
