import chalk from 'chalk'
import {ICONS} from '../../helpers/formatting'

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

export const renderDartSymbolsLocationRequiredError = () =>
  chalk.red(`${ICONS.FAILED} Error: specifying "--dart-symbols" requires specifying "--dart-symbol-location"\n`)

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
