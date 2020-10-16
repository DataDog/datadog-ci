import chalk from 'chalk'

export const renderSupportedValues = (supportedValues: string[]) =>
  `Supported values are: ${chalk.bold(supportedValues.join('", "'))}`

export const renderMissingParameter = (parameter: string, supportedValues?: string[]) =>
  chalk.red(
    `Missing ${chalk.bold(parameter)} parameter.` +
      (supportedValues ? ` ${renderSupportedValues(supportedValues)}\n` : '\n')
  )

export const renderMissingEnvironmentVariable = (variable: string) =>
  chalk.red(`Missing ${chalk.bold(variable)} in your environment.\n`)

export const renderUnsupportedParameterValue = (parameter: string, value: string, supportedValues: string[]) =>
  chalk.red(`Unsupported ${chalk.bold(parameter)} ${value}. ${renderSupportedValues(supportedValues)}\n`)

export const renderMissingReleaseVersionParameter = () =>
  [
    chalk.yellow('┌──────────────────────────────────────────────────────────────────────────────────────┐'),
    chalk.yellow(
      `│ Missing optional ${chalk.bold('--release-version')} parameter.                                        │`
    ),
    chalk.yellow('│ The analysis may use out of date dependencies and produce false positives/negatives. │'),
    chalk.yellow('└──────────────────────────────────────────────────────────────────────────────────────┘'),
    '',
  ].join('\n')

export const renderFailedUpload = (errorMessage: string) => chalk.red(`Failed upload dependencies: ${errorMessage}\n`)

export const renderFailedUploadBecauseOf403 = (errorMessage: string) =>
  renderFailedUpload(
    `${errorMessage}. Check ${chalk.bold('DATADOG_API_KEY')} and ${chalk.bold(
      'DATADOG_APP_KEY'
    )} environment variables.`
  )

export const renderSuccessfulCommand = (duration: number) =>
  chalk.green(`Dependencies uploaded in ${duration} seconds.\n`)

export const renderCommandInfo = (
  dependenciesFilePath: string,
  source: string,
  service: string,
  version: string | undefined,
  dryRun: boolean
) => {
  const lines: string[] = []

  if (dryRun) {
    lines.push(chalk.yellow('DRY-RUN MODE ENABLED. WILL NOT UPLOAD DEPENDENCIES.'))
  }
  lines.push(`${chalk.bold('File')}:    ${dependenciesFilePath}`)
  lines.push(`${chalk.bold('Source')}:  ${source}`)
  lines.push(`${chalk.bold('Service')}: ${service}`)
  if (version) {
    lines.push(`${chalk.bold('Version')}: ${version}`)
  }
  lines.push('')
  lines.push('')

  return lines.join('\n')
}

export const renderDryRunUpload = (): string => `[DRYRUN] ${renderUpload()}`

export const renderUpload = (): string => 'Uploading dependencies...\n'
