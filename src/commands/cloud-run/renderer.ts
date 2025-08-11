import chalk from 'chalk'
import ora from 'ora'

import * as helpersRenderer from '../../helpers/renderer'
import {dryRunTag} from '../../helpers/renderer'

const AUTHENTICATION_INSTRUCTIONS = [
  '\n' + helpersRenderer.renderError('Unable to authenticate with GCP.'),
  'To authenticate with GCP, please follow these steps:',
  "1. If you haven't already, install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install",
  '2. Run "gcloud auth application-default login" and follow the prompts in your browser to log in.',
  '3. After logging in, run the `datadog-ci cloud-run flare` command again.\n',
]
/**
 * @returns instructions on how to authenticate with GCP.
 */
export const renderAuthenticationInstructions = () => {
  return AUTHENTICATION_INSTRUCTIONS.join('\n')
}

export const dryRunPrefix = (isDryRun: boolean) => (isDryRun ? `${dryRunTag} ` : '')

/**
 * Executes an async operation with a spinner
 * @param text - The text to display while spinning
 * @param operation - The async operation to execute
 * @param successText - Success message
 * @returns Promise that resolves with the operation result
 */
export const withSpinner = async <T>(text: string, operation: () => Promise<T>, successText: string): Promise<T> => {
  const spinner = ora({
    color: 'magenta',
    discardStdin: false,
    text,
  })
  spinner.start()

  try {
    const result = await operation()
    spinner.succeed(chalk.green(`${successText}`))

    return result
  } catch (error) {
    // Drop any ... from end of text
    const failText = text.replace(/\.\.\.$/, '')
    spinner.fail(chalk.red(`${failText}`))

    throw error
  }
}
