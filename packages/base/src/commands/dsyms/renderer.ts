import chalk from 'chalk'
import upath from 'upath'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'

import {CompressedDsym, Dsym, DWARF} from './interfaces'
import {pluralize} from './utils'

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderInvalidDsymWarning = (dSYMPath: string) =>
  chalk.yellow(`${ICONS.WARNING} Invalid dSYM file, will be skipped: ${dSYMPath}\n`)

export const renderDSYMSlimmingFailure = (dSYM: Dsym, dwarf: DWARF, error: Error) =>
  chalk.yellow(`${ICONS.WARNING} Failed to export '${dwarf.arch}' arch (${dwarf.uuid}) from ${dSYM.bundle}: ${error}\n`)

export const renderFailedUpload = (dSYM: CompressedDsym, errorMessage: string) => {
  const dSYMPathBold = `[${chalk.bold.dim(dSYM.dsym.bundle)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload dSYM for ${dSYMPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (dSYM: CompressedDsym, errorMessage: string, attempt: number) => {
  const dSYMPathBold = `[${chalk.bold.dim(dSYM.dsym.bundle)}]`

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

  fullStr += chalk.green(
    `Once dSYMs upload is successful files will be processed and ready to use within the next 5 minutes.\n`
  )

  return fullStr
}

export const renderCommandDetail = (intermediateDirectory: string, uploadDirectory: string) =>
  `Will use temporary intermediate directory: ${intermediateDirectory}\n` +
  `Will use temporary upload directory: ${uploadDirectory}\n`

export const renderUpload = (dSYM: CompressedDsym): string => {
  const archiveName = upath.basename(dSYM.archivePath)
  const objectName = dSYM.dsym.dwarf.map((dwarf) => upath.basename(dwarf.object))[0]
  const archs = dSYM.dsym.dwarf.map((dwarf) => dwarf.arch).join()
  const uuids = dSYM.dsym.dwarf.map((dwarf) => dwarf.uuid).join()

  return `Uploading ${archiveName} (${objectName}, arch: ${archs}, UUID: ${uuids})\n`
}
