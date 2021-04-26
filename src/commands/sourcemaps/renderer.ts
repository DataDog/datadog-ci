import chalk from 'chalk'

import {Payload, UploadStatus} from './interfaces'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderSourcesNotFoundWarning = (sourcemap: string) =>
  chalk.yellow(`${ICONS.WARNING} No tracked files found for sources contained in ${sourcemap}\n`)

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderInvalidPrefix = chalk.red(
  `${ICONS.FAILED} --minified-path-prefix should either be an URL (such as "http://example.com/static") or an absolute path starting with a / such as "/static"\n`
)

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (statuses: UploadStatus[], duration: number, dryRun: boolean) => {
  const results = new Map<UploadStatus, number>()
  statuses.forEach(status => {
    if (!results.has(status)) {
      results.set(status, 0)
    }
    results.set(status, results.get(status)! + 1)
  })

  const output = []

  if (results.get(UploadStatus.Success)) {
      if (dryRun) {
          output.push(chalk.green(`${ICONS.SUCCESS} [DRYRUN] successfully handled ${results.get(UploadStatus.Success)} of ${statuses.length} found sourcemaps in ${duration} seconds.`))
      } else {
          output.push(chalk.green(`${ICONS.SUCCESS} successfully uploaded ${results.get(UploadStatus.Success)} of ${statuses.length} found sourcemaps in ${duration} seconds.`))
      }
  }
  if (results.get(UploadStatus.Failure)) {
      output.push(chalk.red(`${ICONS.FAILED} ${results.get(UploadStatus.Failure)} files failed to upload.`))
  }
  if (results.get(UploadStatus.Skipped)) {
      output.push(chalk.yellow(`${ICONS.WARNING}  ${results.get(UploadStatus.Skipped)} files were ignored.`))
  }

  return output.join('\n') + '\n'
}

export const renderCommandInfo = (
  basePath: string,
  minifiedPathPrefix: string,
  projectPath: string,
  releaseVersion: string,
  service: string,
  poolLimit: number,
  dryRun: boolean
) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\n`)
  }
  const startStr = chalk.green(`Starting upload with concurrency ${poolLimit}. \n`)
  fullStr += startStr
  const basePathStr = chalk.green(`Will look for sourcemaps in ${basePath}\n`)
  fullStr += basePathStr
  const minifiedPathPrefixStr = chalk.green(
    `Will match JS files for errors on files starting with ${minifiedPathPrefix}\n`
  )
  fullStr += minifiedPathPrefixStr
  const serviceVersionProjectPathStr = chalk.green(
    `version: ${releaseVersion} service: ${service} project path: ${projectPath}\n`
  )
  fullStr += serviceVersionProjectPathStr

  return fullStr
}

export const renderDryRunUpload = (sourcemap: Payload): string => `[DRYRUN] ${renderUpload(sourcemap)}`

export const renderUpload = (sourcemap: Payload): string =>
  `Uploading sourcemap ${sourcemap.sourcemapPath} for JS file available at ${sourcemap.minifiedUrl}\n`
