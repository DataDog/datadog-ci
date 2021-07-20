import chalk from 'chalk'

import {Payload, UploadStatus} from './interfaces'
import {pluralize} from './utils'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderInvalidPrefix = chalk.red(
  `${ICONS.FAILED} --minified-path-prefix should either be an URL (such as "http://example.com/static") or an absolute path starting with a / such as "/static"\n`
)

export const renderFailedUpload = (payload: Payload, errorMessage: string) => {
  const dSYMPathBold = `[${chalk.bold.dim(payload.path)}]`

  return chalk.red(`${ICONS.FAILED} Failed upload dSYM for ${dSYMPathBold}: ${errorMessage}\n`)
}

export const renderRetriedUpload = (payload: Payload, errorMessage: string, attempt: number) => {
  const dSYMPathBold = `[${chalk.bold.dim(payload.path)}]`

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
    output.push(`Details about the ${pluralize(statuses.length, 'found dSYM', 'found dSYMs')}:`)
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
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD DSYMS\n`)
  }
  const startStr = chalk.green(`Starting upload with concurrency ${poolLimit}. \n`)
  fullStr += startStr
  const basePathStr = chalk.green(`Will look for dSYMs in ${basePath}\n`)
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

export const renderDryRunUpload = (dSYM: Payload): string => `[DRYRUN] ${renderUpload(dSYM)}`

export const renderUpload = (dSYM: Payload): string => `Uploading dSYM with ${dSYM.uuids} from ${dSYM.path}\n`
