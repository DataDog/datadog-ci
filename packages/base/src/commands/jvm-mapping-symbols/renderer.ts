import chalk from 'chalk'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {pluralize} from '@datadog/datadog-ci-base/helpers/utils'

export const renderCommandInfo = (dryRun: boolean, mappingFile: string, buildId: string) => {
  let fullString = ''
  if (dryRun) {
    fullString += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SYMBOLS\n`)
  }
  fullString += chalk.green('Starting upload. \n')
  fullString += chalk.green(`Uploading JVM mapping file ${mappingFile}\n`)
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

export const renderInvalidMappingFile = (path: string, reason: string) =>
  chalk.red(`${ICONS.FAILED} Error: ${path} ${reason}.\n`)

export const renderBuildIdOptionsError = () =>
  chalk.red(
    `${ICONS.FAILED} Error: give the app's build ID with exactly one of --build-id or --build-id-file ` +
      `(the app's 'assets/datadog.buildId' file).\n`
  )

export const renderUnreadableBuildIdFile = (path: string, errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Error: could not read the build ID file ${path}: ${errorMessage}\n`)

export const renderInvalidBuildId = (buildId: string) => {
  // Shortened, in case the wrong file was given.
  const shown = buildId.length > 80 ? `${buildId.slice(0, 80)}…` : buildId

  return chalk.red(
    `${ICONS.FAILED} Error: invalid build ID "${shown}". It must be a UUID, ` +
      `for example 01234567-89ab-cdef-0123-456789abcdef.\n`
  )
}

export const renderBuildIdFileTooLarge = (path: string) =>
  chalk.red(`${ICONS.FAILED} Error: ${path} is too large to be a build ID file.\n`)

export const renderBuildIdWithByteOrderMark = () =>
  chalk.red(
    `${ICONS.FAILED} Error: the build ID starts with a byte order mark (BOM), which the Datadog Android SDK keeps ` +
      `as part of the ID, so it wouldn't match. Write the app's datadog.buildId file without a BOM.\n`
  )

export const renderEventPayload = (payload: string) => chalk.gray(`${ICONS.SUCCESS} Event payload = ${payload}\n`)

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occurred while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

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

export const renderUpload = (filePath: string): string => `Uploading JVM mapping file ${filePath}\n`
