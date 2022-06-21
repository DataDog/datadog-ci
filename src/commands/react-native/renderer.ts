import chalk from 'chalk'

import {ICONS} from '../../helpers/formatting'
import {UploadStatus} from '../../helpers/upload'
import {RNSourcemap} from './interfaces'
import {pluralize} from './utils'

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderGitDataNotAttachedWarning = (sourcemap: string, errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} Could not attach git data for sourcemap ${sourcemap}: ${errorMessage}\n`)

export const renderSourcesNotFoundWarning = (sourcemap: string) =>
  chalk.yellow(`${ICONS.WARNING} No tracked files found for sources contained in ${sourcemap}\n`)

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderFailedUpload = (sourcemap: RNSourcemap, errorMessage: string) => {
  const sourcemapPathBold = `[${chalk.bold.dim(sourcemap.sourcemapPath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: RNSourcemap, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderSuccessfulCommand = (statuses: UploadStatus[], duration: number, dryRun: boolean) => {
  const results = new Map<UploadStatus, number>()
  statuses.forEach((status) => {
    if (!results.has(status)) {
      results.set(status, 0)
    }
    results.set(status, results.get(status)! + 1)
  })

  const output = ['', chalk.bold('Command summary:')]
  if (results.get(UploadStatus.Failure)) {
    output.push(chalk.red(`${ICONS.FAILED} Some sourcemaps have not been uploaded correctly.`))
  } else if (results.get(UploadStatus.Skipped)) {
    output.push(chalk.yellow(`${ICONS.WARNING}  Some sourcemaps have been skipped.`))
  } else if (results.get(UploadStatus.Success)) {
    if (dryRun) {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} [DRYRUN] Handled ${pluralize(
            results.get(UploadStatus.Success)!,
            'sourcemap',
            'sourcemaps'
          )} with success in ${duration} seconds.`
        )
      )
    } else {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} Uploaded ${pluralize(
            results.get(UploadStatus.Success)!,
            'sourcemap',
            'sourcemaps'
          )} in ${duration} seconds.`
        )
      )
    }
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No sourcemaps detected. Did you specify the correct path?`))
  }

  if (results.get(UploadStatus.Failure) || results.get(UploadStatus.Skipped)) {
    output.push(`Details about the ${pluralize(statuses.length, 'found sourcemap', 'found sourcemaps')}:`)
    if (results.get(UploadStatus.Success)) {
      output.push(
        `  * ${pluralize(results.get(UploadStatus.Success)!, 'sourcemap', 'sourcemaps')} successfully uploaded`
      )
    }
    if (results.get(UploadStatus.Skipped)) {
      output.push(
        chalk.yellow(`  * ${pluralize(results.get(UploadStatus.Skipped)!, 'sourcemap was', 'sourcemaps were')} skipped`)
      )
    }
    if (results.get(UploadStatus.Failure)) {
      output.push(
        chalk.red(`  * ${pluralize(results.get(UploadStatus.Failure)!, 'sourcemap', 'sourcemaps')} failed to upload`)
      )
    }
  }

  return output.join('\n') + '\n'
}

export const renderCommandInfo = (
  bundlePath: string,
  sourcemapPath: string,
  platform: string,
  releaseVersion: string,
  service: string,
  poolLimit: number,
  dryRun: boolean,
  projectPath: string,
  buildVersion: string
) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\n`)
  }
  const startStr = chalk.green(`Starting upload with concurrency ${poolLimit}. \n`)
  fullStr += startStr
  const basePathStr = chalk.green(
    `Upload of ${sourcemapPath} for bundle ${bundlePath} on platform ${platform} with project path ${projectPath}\n`
  )
  fullStr += basePathStr
  const serviceVersionProjectPathStr = chalk.green(
    `version: ${releaseVersion} build: ${buildVersion} service: ${service}\n`
  )
  fullStr += serviceVersionProjectPathStr

  return fullStr
}

export const renderUpload = (sourcemap: RNSourcemap): string =>
  `Uploading sourcemap ${sourcemap.sourcemapPath} for JS file available at ${sourcemap.bundlePath}\n`
