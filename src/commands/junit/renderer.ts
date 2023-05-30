import path from 'path'

import chalk from 'chalk'

import {SpanTags} from '../../helpers/interfaces'

import {Payload} from './interfaces'
import {getTestCommitRedirectURL, getTestRunsUrl} from './utils'

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

export const renderFailedGitDBSync = (err: any) => {
  return chalk.red.bold(`${ICONS.FAILED} Could not sync git metadata: ${err}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const jUnitXMLPath = `[${chalk.bold.dim(payload.xmlPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying jUnitXML upload ${jUnitXMLPath}: ${errorMessage}\n`)
}

export const renderSuccessfulUpload = (dryRun: boolean, fileCount: number, duration: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.`)
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Synced git metadata in ${elapsed} seconds.`)
}

export const renderSuccessfulCommand = (spanTags: SpanTags, service: string, env?: string) => {
  let fullStr = ''
  fullStr += chalk.green(
    '=================================================================================================\n'
  )
  fullStr += chalk.green('* View detailed reports on Datadog (they can take a few minutes to become available)\n')

  const redirectTestCommitURL = getTestCommitRedirectURL(spanTags, service, env)
  if (redirectTestCommitURL) {
    fullStr += chalk.green('* Commit report:\n')
    fullStr += chalk.green(`* ${redirectTestCommitURL}\n`)
  }

  const testRunsUrl = getTestRunsUrl(spanTags)
  if (testRunsUrl) {
    fullStr += chalk.green('* Test runs report:\n')
    fullStr += chalk.green(`* ${testRunsUrl}\n`)
  }
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

export const renderDryRunUpload = (payload: Payload): string => `[DRYRUN] ${renderUpload(payload)}`

export const renderUpload = (payload: Payload): string => `Uploading jUnit XML test report file in ${payload.xmlPath}`

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
  fullStr += chalk.green(`service: ${service}`)

  return fullStr
}
