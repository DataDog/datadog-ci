import chalk from 'chalk'
import {Payload} from './interfaces'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (fileCount: number, duration: number) =>
  chalk.green(`${ICONS.SUCCESS} Uploaded ${fileCount} files in ${duration} seconds.\n`)

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

export const renderDryRunUpload = (sourcemapPath: string): string => `[DRYRUN] ${renderUpload(sourcemapPath)} \n`

export const renderUpload = (sourcemapPath: string): string => `Uploading sourcemap ${sourcemapPath}`
