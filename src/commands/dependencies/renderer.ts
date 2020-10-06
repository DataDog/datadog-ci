import chalk from 'chalk'

const ICONS = {
  FAILED: chalk.bold.red('❌'),
  SUCCESS: chalk.bold.green('✅'),
  WARNING: chalk.bold.green('⚠️'),
}

export const renderFailedUpload = (errorMessage: string) =>
  chalk.red(`${ICONS.FAILED} Failed upload dependencies: ${errorMessage}\n`)

export const renderSuccessfulCommand = (duration: number) =>
  chalk.green(`${ICONS.SUCCESS} Uploaded dependencies in ${duration} seconds.\n`)

export const renderCommandInfo = (dependenciesFilePath: string, version: string, service: string, dryRun: boolean) => {
  const lines: string[] = []

  if (dryRun) {
    lines.push(chalk.yellow(`${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD DEPENDENCIES`))
  }
  lines.push(chalk.green('Starting upload.'))
  lines.push(chalk.green(`Will upload dependencies from ${dependenciesFilePath} file.`))
  lines.push(`version: ${version} service: ${service}`)
  lines.push('')

  return lines.join('\n')
}

export const renderDryRunUpload = (): string => `[DRYRUN] ${renderUpload()}`

export const renderUpload = (): string => 'Uploading dependencies\n'
