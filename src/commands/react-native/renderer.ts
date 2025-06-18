import chalk from 'chalk'

import {ICONS} from '../../helpers/formatting'
import {UploadStatus} from '../../helpers/upload'
import {pluralize} from '../../helpers/utils'

import {RNSourcemap} from './interfaces'

export const renderGitWarning = (errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository to fully leverage Datadog's git integration.
To ignore this warning use the --disable-git flag.\n`)

export const renderGitDataNotAttachedWarning = (sourcemap: string, errorMessage: string) =>
  chalk.yellow(`${ICONS.WARNING} Could not attach git data for sourcemap ${sourcemap}: ${errorMessage}\n`)

export const renderSourcesNotFoundWarning = (sourcemap: string) =>
  chalk.yellow(`${ICONS.WARNING} No tracked files found for sources contained in ${sourcemap}\n`)

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderFailedUpload = (sourcemap: RNSourcemap, errorMessage: string) => {
  const sourcemapPathBold = `[${chalk.bold.dim(sourcemap.sourcemapPath)}]`
  let message = chalk.red(`${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}: ${errorMessage}\n`)
  if (errorMessage.includes('413 (Request Entity Too Large)')) {
    message = `${message}\n It looks like your sourcemap is too large. To make it lighter you can:
    - Pass an empty file as --bundle argument to the upload command (no impact on the error explorer as of now)
    - Pass the --remove-sources-content argument to the upload command (you will lose the code snippet next to the unminified error)
    - Try to split your bundle, by using a tool such as repack (https://github.com/callstack/repack)\n`
  }

  return message
}

export const renderRetriedUpload = (payload: RNSourcemap, errorMessage: string, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}: ${errorMessage}\n`)
}

export const renderRemoveSourcesContentWarning = () =>
  `Removing the "sourcesContent" part of the sourcemap file. ${chalk.yellow(
    'Use the --remove-sources-content only if your sourcemap file is too heavy to upload to Datadog.\n'
  )}`

export const renderFailedSourcesContentRemovalError = (payload: RNSourcemap, errorMessage: string) => `${chalk.red(
  `An error occured while removing the "sourcesContent" part of the sourcemap file ${payload.sourcemapPath}": ${errorMessage}`
)}.
  Trying to upload the full sourcemap with the "sourcesContent".`

/**
 * As of now, this command takes an array of one signe UploadStatus element since we only support upload
 * of a single sourcemap.
 * We considered it was preferable to leave it this way so it's ready for multiple sourcemaps uploads,
 * rather than investing into adapting it for this purpose.
 * This comment should be removed once the multiple file upload is available.
 */
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
    output.push(chalk.red(`${ICONS.FAILED} Some sourcemaps have not been uploaded correctly.`))
  } else if (results.get(UploadStatus.Skipped)) {
    output.push(chalk.yellow(`${ICONS.WARNING}  Some sourcemaps have been skipped.`))
  } else if (results.get(UploadStatus.Success)) {
    if (dryRun) {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} [DRYRUN] Handled ${pluralize(
            results.get(UploadStatus.Success)!,
            'sourcemap',
            'sourcemaps'
          )} with success in ${duration} seconds.`
        )
      )
    } else {
      output.push(
        chalk.green(
          `${ICONS.SUCCESS} Uploaded ${pluralize(
            results.get(UploadStatus.Success)!,
            'sourcemap',
            'sourcemaps'
          )} in ${duration} seconds.`
        )
      )
    }
  } else {
    output.push(chalk.yellow(`${ICONS.WARNING} No sourcemaps detected. Did you specify the correct path?`))
  }

  if (results.get(UploadStatus.Failure) || results.get(UploadStatus.Skipped)) {
    output.push(`Details about the ${pluralize(statuses.length, 'found sourcemap', 'found sourcemaps')}:`)
    if (results.get(UploadStatus.Success)) {
      output.push(
        `  * ${pluralize(results.get(UploadStatus.Success)!, 'sourcemap', 'sourcemaps')} successfully uploaded`
      )
    }
    if (results.get(UploadStatus.Skipped)) {
      output.push(
        chalk.yellow(`  * ${pluralize(results.get(UploadStatus.Skipped)!, 'sourcemap was', 'sourcemaps were')} skipped`)
      )
    }
    if (results.get(UploadStatus.Failure)) {
      output.push(
        chalk.red(`  * ${pluralize(results.get(UploadStatus.Failure)!, 'sourcemap', 'sourcemaps')} failed to upload`)
      )
    }
  }

  return output.join('\n') + '\n'
}

export const renderCommandInfo = (
  bundlePath: string | undefined,
  sourcemapPath: string,
  platform: string,
  releaseVersion: string,
  service: string,
  poolLimit: number,
  dryRun: boolean,
  projectPath: string,
  buildVersion: string,
  bundleName: string
) => {
  let fullStr = ''
  if (dryRun) {
    fullStr += chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\n`)
  }
  const startStr = chalk.green('Starting upload. \n')
  fullStr += startStr
  if (!bundlePath) {
    fullStr += chalk.red(
      `${ICONS.WARNING} --bundle option was not provided. A default bundle name will be used. Please update @datadog/mobile-react-native or pass a --bundle option.\n`
    )
  }
  fullStr += chalk.green(
    `Upload of ${sourcemapPath} for bundle ${bundleName} on platform ${platform} with project path ${projectPath}\n`
  )

  const serviceVersionProjectPathStr = chalk.green(
    `version: ${releaseVersion} build: ${buildVersion} service: ${service}\n`
  )

  fullStr += serviceVersionProjectPathStr

  fullStr += chalk.green(
    `Please ensure you use the same values during SDK initialization to guarantee the success of the unminify process.\n`
  )

  fullStr += chalk.green(
    `After upload is successful sourcemap files will be processed and ready to use within the next 5 minutes. \n`
  )

  return fullStr
}

export const renderUpload = (sourcemap: RNSourcemap): string =>
  `Uploading sourcemap ${sourcemap.sourcemapPath} for JS file ${sourcemap.bundleName}\n`
