import chalk from 'chalk'

import {ICONS} from '../../helpers/formatting'
import {UploadStatus} from '../../helpers/upload'
import {pluralize} from '../../helpers/utils'

import {MappingMetadata} from './interfaces'

export interface UploadInfo {
  fileType: string
  location: string
  platform: string
}

export const renderCommandInfo = (dryRun: boolean, symbolsLocations: string[]) => {
  let fullString = ''
  if (dryRun) {
    fullString += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SYMBOLS\n`)
  }
  const startStr = chalk.green('Starting upload. \n')

  fullString += startStr
  fullString += chalk.green(`Uploading symbols from location(s): ${symbolsLocations.join(' ')}\n`)

  fullString += chalk.green(
    `After upload is successful symbol files will be processed and ready to use within the next 5 minutes.\n`
  )

  return fullString
}

export const renderCommandSummary = (statuses: UploadStatus[], duration: number, dryRun: boolean) => {
  const results = new Map<UploadStatus, number>()
  statuses.forEach((status) => {
    if (!results.has(status)) {
      results.set(status, 0)
    }
    results.set(status, results.get(status)! + 1)
  })

  const output = ['', chalk.bold('Command summary:')]
  if (results.get(UploadStatus.Failure)) {
    output.push(chalk.red(`${ICONS.FAILED} Some symbol files may not been uploaded correctly.`))
  } else if (results.get(UploadStatus.Skipped)) {
    output.push(chalk.yellow(`${ICONS.WARNING}  Some symbol files have been skipped.`))
  } else if (results.get(UploadStatus.Success)) {
    if (dryRun) {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} [DRYRUN] Handled symbol ${pluralize(
            results.get(UploadStatus.Success)!,
            'file',
            'files'
          )} with success in ${duration} seconds.`
        )
      )
    } else {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} Uploaded symbol ${pluralize(
            results.get(UploadStatus.Success)!,
            'file',
            'files'
          )} in ${duration} seconds.`
        )
      )
    }
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No actions were taken. Did you specify the correct path?`))
  }

  return output.join('\n') + '\n'
}

export const renderMissingBuildId = (path: string) =>
  chalk.red(`${ICONS.FAILED} Error: Invalid or missing 'build_id' file. Expected at path ${path}`)

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderWarning = (errorMessage: string) => chalk.yellow(`${ICONS.WARNING} ${errorMessage}.\n`)

export const renderArgumentMissingError = (argumentName: string) =>
  chalk.red(`${ICONS.FAILED} Error: parameter "${argumentName}" is required.\n`)

export const renderInvalidSymbolsLocation = (symbolsDirectory: string) =>
  chalk.red(`${ICONS.FAILED} Failed to get symbols files - ${symbolsDirectory} is not a file, nor a directory.\n`)

export const renderMissingBinUtils = () =>
  chalk.red(`${ICONS.FAILED} Could not find required 'objcopy' program. Please install binutils.\n`)

export const renderGeneralizedError = (error: any) => {
  let str = chalk.red(`${ICONS.FAILED} Error: ${error}\n`)
  str += error.stack

  return str
}

export const renderFailedUpload = (filePath: string, errorMessage: string) => {
  const filePathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload for ${filePathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (filePath: string, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderUpload = (filePath: string, metadata: MappingMetadata): string =>
  `Uploading debug info for ELF file ${filePath} (arch:${metadata.arch || 'none'} \
GNUBuildID:${metadata.gnu_build_id || 'none'} \
GoBuildID:${metadata.go_build_id || 'none'} \
FileHash:${metadata.file_hash || 'none'})\n`
