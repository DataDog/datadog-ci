import type {NdkArch} from './interfaces'

import chalk from 'chalk'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {pluralize} from '@datadog/datadog-ci-base/helpers/utils'

export const renderCommandInfo = (dryRun: boolean, buildId: string, symbolsLocations: string[]) => {
  let fullString = ''
  if (dryRun) {
    fullString += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SYMBOLS\n`)
  }
  fullString += chalk.green('Starting upload. \n')
  fullString += chalk.green(`Uploading native libraries from location(s): ${symbolsLocations.join(' ')}\n`)
  fullString += chalk.green(`  buildId: ${buildId}\n`)
  fullString += chalk.green(
    `After upload is successful symbol files will be processed and ready to use within the next 5 minutes.\n`
  )

  return fullString
}

export const renderCommandSummary = (statuses: UploadStatus[], duration: number, dryRun: boolean) => {
  const results = new Map<UploadStatus, number>()
  statuses.forEach((status) => {
    results.set(status, (results.get(status) ?? 0) + 1)
  })

  const output = ['', chalk.bold('Command summary:')]
  if (results.get(UploadStatus.Failure)) {
    output.push(chalk.red(`${ICONS.FAILED} Some symbol files may not been uploaded correctly.`))
  } else if (results.get(UploadStatus.Skipped)) {
    output.push(chalk.yellow(`${ICONS.WARNING}  Some symbol files have been skipped.`))
  } else if (results.get(UploadStatus.Success)) {
    const files = pluralize(results.get(UploadStatus.Success)!, 'file', 'files')
    if (dryRun) {
      output.push(chalk.green(`${ICONS.SUCCESS} [DRYRUN] Handled symbol ${files} with success in ${duration} seconds.`))
    } else {
      output.push(chalk.green(`${ICONS.SUCCESS} Uploaded symbol ${files} in ${duration} seconds.`))
    }
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No actions were taken. Did you specify the correct path?`))
  }

  return output.join('\n') + '\n'
}

export const renderArgumentMissingError = (argumentName: string) =>
  chalk.red(`${ICONS.FAILED} Error: parameter "${argumentName}" is required.\n`)

export const renderInvalidBuildId = (buildId: string) =>
  chalk.red(
    `${ICONS.FAILED} Error: invalid build ID "${buildId}". It must be a UUID, ` +
      `for example 01234567-89ab-cdef-0123-456789abcdef.\n`
  )

export const renderInvalidSymbolsLocation = (location: string) =>
  chalk.red(`${ICONS.FAILED} Error: ${location} does not exist, or is not a file or a directory.\n`)

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occurred while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderGeneralizedError = (error: any) => {
  let str = chalk.red(`${ICONS.FAILED} Error: ${error}\n`)
  str += error.stack

  return str
}

export const renderNotANativeLibrary = (path: string, reason: string) =>
  chalk.yellow(`${ICONS.WARNING} Skipping ${path}: ${reason}.\n`)

export const renderNoSymbols = (path: string) =>
  chalk.yellow(`${ICONS.WARNING} Skipping ${path}: it has no symbols (no symbol table and no debug info).\n`)

export const renderAllLibrariesStripped = (count: number) =>
  chalk.yellow(
    `${ICONS.WARNING} None of the ${pluralize(count, 'native library', 'native libraries')} found has symbols, ` +
      `nothing was uploaded. Upload the libraries before they're stripped.\n`
  )

export const renderDuplicate = (path: string, uploadedPath: string) =>
  `Skipping ${path}: same file as ${uploadedPath}.\n`

export const renderConflictingLibraries = (arch: NdkArch, filename: string, paths: string[]) =>
  chalk.red(
    `${ICONS.FAILED} Not uploading ${arch} ${filename}: files with this name and architecture have different content, ` +
      `and only one can be stored for a build ID. Upload only the libraries of this build:\n` +
      paths.map((path) => `  - ${path}\n`).join('')
  )

export const renderUnexpectedName = (path: string) =>
  chalk.yellow(
    `${ICONS.WARNING} Skipping ${path}: Android only loads native libraries named lib*.so, so crash frames can't ` +
      `refer to this file. Upload the libraries under the names they have in the app package (APK or AAB).\n`
  )

export const renderDebugOnlyFile = (path: string) =>
  chalk.yellow(
    `${ICONS.WARNING} Skipping ${path}: it's a debug-only copy (it has no code), not the library itself. ` +
      `Upload the library before it's stripped instead.\n`
  )

export const renderUnverifiedLibrary = (arch: NdkArch, filename: string) =>
  chalk.red(
    `${ICONS.FAILED} Not uploading ${arch} ${filename}: another file with this name couldn't be read, ` +
      `so it can't be checked that they're the same library.\n`
  )

export const renderUnreadableFolder = (path: string, errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Could not read the folder ${path}: ${errorMessage}\n`)

export const renderUnreadableFile = (path: string, errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Could not read ${path}: ${errorMessage}\n`)

export const renderCounts = (uploaded: number, skipped: number, failed: number, dryRun: boolean) =>
  `${dryRun ? '[DRYRUN] ' : ''}Native libraries: ${uploaded} ${dryRun ? 'to upload' : 'uploaded'}, ` +
  `${skipped} skipped, ${failed} failed.\n`

export const renderFailedUpload = (filePath: string, errorMessage: string) => {
  const filePathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload for ${filePathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (filePath: string, errorMessage: string, attempt: number) => {
  const filePathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying upload ${filePathBold}: ${errorMessage}\n`)
}

export const renderUpload = (filePath: string, arch: NdkArch): string =>
  `Uploading native library (${arch}) ${filePath}\n`
