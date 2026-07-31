import type {Payload, RepoFile} from './interfaces'
import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

import chalk from 'chalk'
import upath from 'upath'

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
    let message = `Uploading code coverage report file(s) in ${payload.paths}`
    if (payload.flags && payload.flags.length > 0) {
      message += ` with flags: ${payload.flags.join(', ')}`
    }

    return message
  } else {
    return 'No code coverage report paths, doing nothing'
  }
}

export const renderCommandInfo = (reportPaths: string[], dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORTS\n`)
  }
  fullStr += chalk.green(`${new Date().toLocaleString()} - Starting upload. \n`)
  if (!!reportPaths.length) {
    if (reportPaths.length === 1 && !!upath.extname(reportPaths[0])) {
      fullStr += chalk.green(`Will upload code coverage report file ${reportPaths[0]}`)
    } else {
      fullStr += chalk.green(`Will look for code coverage report files in ${reportPaths.join(', ')}`)
    }
  }

  return fullStr
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number) => {
  return chalk.green(`${dryRun ? '[DRYRUN] ' : ''}${ICONS.SUCCESS} Synced git metadata in ${elapsed} seconds.`)
}

export const renderFailedGitDBSync = (err: any) => {
  return chalk.red.bold(`${ICONS.FAILED} Could not sync git metadata: ${err}\n`)
}

export const renderCoverageConfigReadError = (path: string, errorMessage: string) => {
  return chalk.red(
    `${ICONS.FAILED} Could not read the code coverage configuration file [${chalk.bold.dim(
      path
    )}] given by --coverage-config: ${errorMessage}\n`
  )
}

export const renderNoCoverageConfigFound = (commit: string | undefined, searchRoots: string[]) => {
  const searchedIn = [
    ...(commit ? [`in the files committed at ${commit}`] : []),
    ...(searchRoots.length ? [`on disk in ${searchRoots.join(', ')}`] : []),
  ].join(' and ')

  return chalk.yellow(
    `${ICONS.WARNING} No code coverage configuration found (looked ${searchedIn}); the organization-level configuration will be used. Pass --coverage-config <path> to upload a configuration that is not committed.`
  )
}

export const renderOversizedRepoFile = (label: string, file: {path: string; size: number}, maxSize: number) => {
  return chalk.yellow(
    `${ICONS.WARNING} Not uploading the content of ${label} [${chalk.bold.dim(file.path)}]: it is ${
      file.size
    } bytes, which exceeds the ${maxSize} bytes limit. Only its path and SHA are sent.`
  )
}

export const renderOversizedReport = (path: string, size: number, maxSize: number) => {
  return chalk.yellow(
    `${ICONS.WARNING} The coverage report [${chalk.bold.dim(path)}] is ${size} bytes, which on its own exceeds the ${maxSize} bytes the intake accepts per request. It is uploaded anyway, but the request may be rejected.`
  )
}

export const renderAttachedRepoFile = (dryRun: boolean, label: string, file: RepoFile) => {
  return chalk.green(
    `${dryRun ? '[DRYRUN] ' : ''}Uploading ${label} ${file.path} (${file.size ?? 0} bytes, sha ${file.sha})`
  )
}

export const renderRepoFileNotAttached = (label: string, file: RepoFile) => {
  return `Not uploading the content of ${label} ${file.path} (sha ${file.sha}): the file is not in the working directory, so it will be read from the repository instead.`
}
