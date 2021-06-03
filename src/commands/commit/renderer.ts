import chalk from 'chalk'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderGitError = (errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} An error occured while invoking git: ${errorMessage}
Make sure the command is running within your git repository.\n`)

export const renderConfigurationError = (error: Error) => chalk.red(`${ICONS.FAILED} Configuration error: ${error}.\n`)

export const renderFailedUpload = (errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Failed upload: ${errorMessage}\n`)

export const renderRetriedUpload = (errorMessage: string, attempt: number) =>
  chalk.yellow(`[attempt ${attempt}] Retrying upload: ${errorMessage}\n`)

export const renderUpload = 'Uploading\n'

export const renderSuccessfulCommand = (duration: number, dryRun: boolean) => {
  if (dryRun) {
    return chalk.green(`${ICONS.SUCCESS} [DRYRUN] Handled in ${duration} seconds.\n`)
  } else {
    return chalk.green(`${ICONS.SUCCESS} Uploaded in ${duration} seconds.\n`)
  }
}

export const renderCommandInfo = (dryRun: boolean) => {
  if (dryRun) {
    return chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD\n`)
  }

  return chalk.green('Starting upload. \n')
}
