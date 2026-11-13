import * as helpersRenderer from '@datadog/datadog-ci-base/helpers/renderer'
import {dryRunTag} from '@datadog/datadog-ci-base/helpers/renderer'
import chalk from 'chalk'
import ora from 'ora'

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
 * Executes an async operation with a spinner that shows elapsed time.
 * @param text - The text to display while spinning
 * @param operation - The async operation to execute. Call `setStatus` to show its current stage.
 * @param successText - Success message
 * @returns Promise that resolves with the operation result
 *
 * ```txt
 * ⠋ Instrumenting service my-service... Deploying Revision. (1m 05s)
 * ```
 */
export const withSpinner = async <T>(
  text: string,
  operation: (setStatus: (status: string) => void) => Promise<T>,
  successText: string
): Promise<T> => {
  const spinner = ora({
    color: 'magenta',
    discardStdin: false,
    text,
  })
  const startedAt = Date.now()
  let status = ''
  const render = () => {
    spinner.text = [text, status, chalk.dim(`(${formatElapsed(Date.now() - startedAt)})`)].filter(Boolean).join(' ')
  }
  const setStatus = (newStatus: string) => {
    status = newStatus
    render()
  }
  const timer = setInterval(render, 1000)
  spinner.start()

  try {
    const result = await operation(setStatus)
    spinner.succeed(chalk.green(`${successText}`))

    return result
  } catch (error) {
    // Drop any ... from end of text
    const failText = text.replace(/\.\.\.$/, '')
    spinner.fail(chalk.red(`${failText}`))

    throw error
  } finally {
    clearInterval(timer)
  }
}

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = `${totalSeconds % 60}s`

  return minutes > 0 ? `${minutes}m ${seconds.padStart(3, '0')}` : seconds
}
