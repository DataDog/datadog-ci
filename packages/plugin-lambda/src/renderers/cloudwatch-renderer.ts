import {dryRunTag, renderError} from '@datadog/datadog-ci-base/helpers/renderer'
import chalk from 'chalk'
import ora from 'ora'

export const renderCloudwatchHeader = (action: 'disable' | 'enable', isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''
  const verb = action === 'disable' ? 'Disabling' : 'Enabling'

  return `\n${prefix}🐶 ${verb} CloudWatch Logs for Lambda functions\n`
}

export const renderNoFunctionsSpecifiedError = () =>
  renderError('No functions specified. Use -f, --function, or --functions-regex.')

export const renderFunctionsAndFunctionsRegexOptionsBothSetError = (functionsCommandUsed: boolean) => {
  const usedCommand = functionsCommandUsed ? '"--functions"' : 'Functions in config file'

  return renderError(`${usedCommand} and "--functions-regex" should not be used at the same time.`)
}

export const renderRegexSetWithARNError = () => renderError(`"--functions-regex" isn't meant to be used with ARNs.`)

export const renderCouldntGroupFunctionsError = (error: unknown) => renderError(`Couldn't group functions. ${error}`)

export const renderDryRunFunctionAction = (action: 'disable' | 'enable', functionName: string, roleName: string) => {
  const verb = action === 'disable' ? 'Attach' : 'Remove'

  return `${dryRunTag} ${verb} DenyCloudWatchLogs policy on role ${chalk.bold(roleName)} for ${chalk.bold(functionName)}\n`
}

export const renderFunctionSuccess = (action: 'disable' | 'enable', functionName: string, roleName: string) => {
  const verb = action === 'disable' ? 'Attached' : 'Removed'

  return `${chalk.bold(chalk.green('✔'))} ${verb} DenyCloudWatchLogs policy on role ${chalk.bold(roleName)} for ${chalk.bold(functionName)}\n`
}

export const renderFunctionError = (functionName: string, error: unknown) =>
  renderError(`Failed processing ${chalk.bold(functionName)}: ${error}`)

export const processingFunctionsSpinner = (region: string, count: number) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `${chalk.bold(`[${region}]`)} Processing ${chalk.bold(count)} ${chalk
      .hex('#FF9900')
      .bold('Lambda')} functions.\n`,
  })

export const renderProcessedFunctions = (region: string, count: number) =>
  `${chalk.bold(`[${region}]`)} Processed ${chalk.bold(count)} ${chalk.hex('#FF9900').bold('Lambda')} functions.\n`

export const renderFailedProcessingFunctions = (region: string) =>
  `${chalk.bold(`[${region}]`)} Failed processing ${chalk.hex('#FF9900').bold('Lambda')} functions.\n`
