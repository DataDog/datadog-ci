import type {MappingMetadata} from './interfaces'

import chalk from 'chalk'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {pluralize} from '@datadog/datadog-ci-base/helpers/utils'

export const renderCommandInfo = (dryRun: boolean, symbolsLocations: string[]) => {
  let fullString = ''
  if (dryRun) {
    fullString += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SYMBOLS\n`)
  }
  const startStr = chalk.green('Starting upload. \n')

  fullString += startStr
  fullString += chalk.green(`Uploading Portable PDBs from location(s): ${symbolsLocations.join(' ')}\n`)

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

export const renderEventPayload = (payload: string) => chalk.gray(`${ICONS.SUCCESS} Event payload = ${payload}\n`)

export const renderMissingManifestEntry = (assemblyName: string, pdbPath: string) =>
  chalk.yellow(`${ICONS.WARNING} Skipped '${pdbPath}': no debug ID manifest entry found for assembly "${assemblyName}"`)

export const renderManifestNotFound = (manifestPath: string) =>
  chalk.red(`${ICONS.FAILED} Error: debug ID manifest file '${manifestPath}' does not exist.\n`)

export const renderInvalidManifest = (manifestPath: string, errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Error: could not read debug ID manifest '${manifestPath}': ${errorMessage}\n`)

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occurred while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderWarning = (errorMessage: string) => chalk.yellow(`${ICONS.WARNING} ${errorMessage}.\n`)

export const renderArgumentMissingError = (argumentName: string) =>
  chalk.red(`${ICONS.FAILED} Error: parameter "${argumentName}" is required.\n`)

export const renderInvalidSymbolsLocation = (symbolsDirectory: string) =>
  chalk.red(`${ICONS.FAILED} Failed to get symbols files - ${symbolsDirectory} is not a file, nor a directory.\n`)

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
  const filePathBold = `[${chalk.bold.dim(filePath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying upload ${filePathBold}: ${errorMessage}\n`)
}

export const renderUpload = (filePath: string, metadata: MappingMetadata): string =>
  `Uploading Portable PDB for ${filePath} (assembly:${metadata.assembly_name} debug_id:${metadata.debug_id})\n`
