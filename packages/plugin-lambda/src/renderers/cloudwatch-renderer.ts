import {dryRunTag, renderError} from '@datadog/datadog-ci-base/helpers/renderer'
import chalk from 'chalk'

export const renderCloudwatchHeader = (action: 'disable' | 'enable', isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''
  const verb = action === 'disable' ? 'Disabling' : 'Enabling'

  return `\n${prefix}🐶 ${verb} CloudWatch Logs for Lambda functions\n`
}

export const renderNoFunctionsSpecifiedError = () =>
  renderError('No functions specified. Use -f, --function, or --functions-regex.')

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
