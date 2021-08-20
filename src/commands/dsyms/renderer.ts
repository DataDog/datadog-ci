import chalk from 'chalk'

import {Dsym} from './interfaces'
import {pluralize} from './utils'

import {ICONS} from '../../helpers/formatting'
import {UploadStatus} from '../../helpers/upload'

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderFailedUpload = (dSYM: Dsym, errorMessage: string) => {
  const dSYMPathBold = `[${chalk.bold.dim(dSYM.path)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload dSYM for ${dSYMPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (dSYM: Dsym, errorMessage: string, attempt: number) => {
  const dSYMPathBold = `[${chalk.bold.dim(dSYM.path)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying dSYM upload ${dSYMPathBold}: ${errorMessage}\n`)
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
    output.push(chalk.red(`${ICONS.FAILED} Some dSYMS have not been uploaded correctly.`))
  } else if (results.get(UploadStatus.Skipped)) {
    output.push(chalk.yellow(`${ICONS.WARNING}  Some dSYMs have been skipped.`))
  } else if (results.get(UploadStatus.Success)) {
    if (dryRun) {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} [DRYRUN] Handled ${pluralize(
            results.get(UploadStatus.Success)!,
            'dSYM',
            'dSYMs'
          )} with success in ${duration} seconds.`
        )
      )
    } else {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} Uploaded ${pluralize(
            results.get(UploadStatus.Success)!,
            'dSYM',
            'dSYMs'
          )} in ${duration} seconds.`
        )
      )
    }
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No dSYMs detected. Did you specify the correct directory?`))
  }

  if (results.get(UploadStatus.Failure) || results.get(UploadStatus.Skipped)) {
    output.push(`Details about the found ${pluralize(statuses.length, 'dSYM', 'dSYMs')}:`)
    if (results.get(UploadStatus.Success)) {
      output.push(`  * ${pluralize(results.get(UploadStatus.Success)!, 'dSYM', 'dSYMs')} successfully uploaded`)
    }
    if (results.get(UploadStatus.Skipped)) {
      output.push(
        chalk.yellow(`  * ${pluralize(results.get(UploadStatus.Skipped)!, 'dSYM was', 'dSYMs were')} skipped`)
      )
    }
    if (results.get(UploadStatus.Failure)) {
      output.push(chalk.red(`  * ${pluralize(results.get(UploadStatus.Failure)!, 'dSYM', 'dSYMs')} failed to upload`))
    }
  }

  return output.join('\n') + '\n'
}

export const renderCommandInfo = (basePath: string, poolLimit: number, dryRun: boolean) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD DSYMS\n`)
  }
  const startStr = chalk.green(`Starting upload with concurrency ${poolLimit}. \n`)
  fullStr += startStr
  const basePathStr = chalk.green(`Will look for dSYMs in ${basePath}\n`)
  fullStr += basePathStr

  return fullStr
}

export const renderUpload = (dSYM: Dsym): string => `Uploading dSYM with ${dSYM.uuids} from ${dSYM.path}\n`
