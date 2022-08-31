import chalk from 'chalk'
import {ICONS} from '../../helpers/formatting'
import {UploadStatus} from '../../helpers/upload'
import {pluralize} from '../../helpers/utils'

export interface UploadInfo {
  fileType: string
  location: string
  platform: string
}

export const renderCommandInfo = (
  dryRun: boolean,
  version: string,
  service: string,
  flavor: string,
  uploadInfo: UploadInfo[]
) => {
  let fullString = ''
  if (dryRun) {
    fullString += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\n`)
  }
  const startStr = chalk.green('Starting upload. \n')

  fullString += startStr
  uploadInfo.forEach((ui) => {
    fullString += chalk.green(`Uploaing ${ui.platform} ${ui.fileType} at location ${ui.location}\n`)
  })
  const serviceVersionProjectPathStr = chalk.green(`  version: ${version} service: ${service}\n flavor: ${flavor}`)
  fullString += serviceVersionProjectPathStr

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
}

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderArgumentMissingError = (argumentName: string) =>
  chalk.red(`${ICONS.FAILED} Error: parameter "${argumentName}" is required.\n`)

export const renderMissingPubspecError = (pubspecLocation: string) =>
  chalk.red(
    `${ICONS.FAILED} Could not find pubspec at '${pubspecLocation}'. A pubspec.yaml is required or the --version argument must be sepcified.\n`
  )

export const renderInvalidPubspecError = (pubspecLocation: string) =>
  chalk.red(`${ICONS.FAILED} Could not parse pubspec at '${pubspecLocation}'. Check your pubspec for errors.\n`)

export const renderPubspecMissingVersionError = (pubspecLocation: string) =>
  chalk.red(
    `${ICONS.FAILED} pubspec at '${pubspecLocation}' does not contain a version. Supply a version in the pubspec or use the --version argument.\n`
  )

export const renderMissingDartSymbolsDir = (symbolsDirectory: string) =>
  chalk.red(`${ICONS.FAILED} Error: Could not locate Dart Symbols at ${symbolsDirectory}.\n`)

export const renderInvalidSymbolsDir = (symbolsDirectory: string) =>
  chalk.red(`${ICONS.FAILED} Failed to get symbols files - ${symbolsDirectory} is not a directory.`)

export const renderMissingAndroidMappingFile = (mappingLocation: string) =>
  chalk.red(`${ICONS.FAILED} Error: Could not locate Android Mapping file at ${mappingLocation}.\n`)

export const renderGeneralizedError = (error: any) => chalk.red(`${ICONS.FAILED} Error: ${error}\n`)

export const renderFailedUpload = (filePath: string, errorMessage: string) => {
  const filePathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload for ${filePathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (filePath: string, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderUpload = (type: string, filePath: string): string => `Uploading ${type} ${filePath}\n`
