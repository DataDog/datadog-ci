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

export const renderSummarySuccess = (action: 'disable' | 'enable', count: number) => {
  const verb = action === 'disable' ? 'disabled' : 'enabled'

  return `\n${chalk.bold(chalk.green('✔'))} Successfully ${verb} CloudWatch Logs for ${count} function${count !== 1 ? 's' : ''}.\n`
}

export const renderSummaryFailure = (action: 'disable' | 'enable', successCount: number, failureCount: number) => {
  const verb = action === 'disable' ? 'disable' : 'enable'
  const total = successCount + failureCount

  return `\n${chalk.bold(chalk.red('✖'))} Failed to ${verb} CloudWatch Logs for ${failureCount} out of ${total} function${total !== 1 ? 's' : ''}. See errors above for details.\n`
}
