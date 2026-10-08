import type {WasmSourcemapMetadata} from './interfaces'

import chalk from 'chalk'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {pluralize} from '@datadog/datadog-ci-base/helpers/utils'

export const renderCommandInfo = (
  dryRun: boolean,
  basePath: string,
  service: string,
  version: string,
  minifiedPathPrefix: string
) => {
  let output = ''
  if (dryRun) {
    output += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\n`)
  }
  output += chalk.green('Starting upload.\n')
  output += chalk.green(`Uploading WASM sourcemaps from: ${basePath}\n`)
  output += chalk.green(`  service: ${service} version: ${version}\n`)
  output += chalk.green(`  minified path prefix: ${minifiedPathPrefix}\n`)

  return output
}

export const renderCommandSummary = (statuses: UploadStatus[], duration: number, dryRun: boolean) => {
  const successes = statuses.filter((status) => status === UploadStatus.Success).length
  const failures = statuses.filter((status) => status === UploadStatus.Failure).length
  const output = ['', chalk.bold('Command summary:')]

  if (failures > 0) {
    output.push(chalk.red(`${ICONS.FAILED} Some WASM sourcemaps may not have been uploaded correctly.`))
  } else if (successes > 0) {
    const action = dryRun ? '[DRYRUN] Handled' : 'Uploaded'
    output.push(
      chalk.green(
        `${ICONS.SUCCESS} ${action} ${successes} WASM ${pluralize(successes, 'sourcemap', 'sourcemaps')} in ${duration} seconds.`
      )
    )
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No WASM sourcemaps were found.`))
  }

  return output.join('\n') + '\n'
}

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occurred while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderInvalidLocation = (location: string) =>
  chalk.red(`${ICONS.FAILED} ${location} is not an existing file or directory.\n`)

export const renderInvalidSourcemapFilename = (location: string) =>
  chalk.red(`${ICONS.FAILED} ${location} must have a .wasm.map extension.\n`)

export const renderInvalidPrefix = () =>
  chalk.red(`${ICONS.FAILED} --minified-path-prefix must be an absolute URL or an absolute path.\n`)

export const renderMissingOption = (option: string) => chalk.red(`${ICONS.FAILED} Missing ${option}.\n`)

export const renderMissingModule = (modulePath: string) =>
  chalk.yellow(`${ICONS.WARNING} Skipping sourcemap because its WASM module was not found: ${modulePath}\n`)

export const renderGeneralizedError = (error: unknown) => {
  const stack = error instanceof Error ? error.stack : undefined

  return chalk.red(`${ICONS.FAILED} Error: ${String(error)}${stack ? `\n${stack}` : ''}\n`)
}

export const renderFailedUpload = (filePath: string, errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Failed upload for [${chalk.bold.dim(filePath)}]: ${errorMessage}\n`)

export const renderRetriedUpload = (filePath: string, errorMessage: string, attempt: number) =>
  chalk.yellow(`[attempt ${attempt}] Retrying upload [${chalk.bold.dim(filePath)}]: ${errorMessage}\n`)

export const renderUpload = (filePath: string, metadata: WasmSourcemapMetadata) =>
  `Uploading WASM sourcemap ${filePath} for ${metadata.minified_url}\n`
