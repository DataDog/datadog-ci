import {
  dryRunTag,
  errorTag,
  warningTag,
  warningExclamationSignTag,
  successCheckmarkTag,
  failCrossTag,
} from './common-renderer'

/**
 * @returns a header indicating which `lambda` subcommand is running.
 * @param isDryRun whether or not the command is a dry run. Defaults to false.
 *
 * ```txt
 * [Dry Run] 🐶 Instrumenting Lambda function
 * ```
 */
export const renderLambdaFlareHeader = (isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  return `\n${prefix}🐶 Generating Lambda flare to send your configuration to Datadog\n`
}

/**
 * @param error an error message
 * @returns the provided error prefixed by {@link errorTag}.
 *
 * ```txt
 * [Error] The provided error goes here!
 * ```
 */
export const renderError = (error: string) => `\n${errorTag} ${error}\n`

/**
 * @param warning the message to warn about.
 * @returns the provided warning prefixed by {@link warningTag}.
 *
 * ```txt
 * [Warning] The provided warning goes here!
 * ```
 */
export const renderWarning = (warning: string) => `${warningTag} ${warning}\n`

/**
 * @param warning the message to warn about.
 * @returns the provided warning prefixed by {@link warningExclamationSignTag}.
 *
 * ```txt
 * [!] The provided warning goes here!
 * ```
 */
export const renderSoftWarning = (warning: string) => `${warningExclamationSignTag} ${warning}\n`

/**
 * @param message the message to set with the success tag.
 * @returns the provided message prefixed by {@link successCheckmarkTag}.
 *
 * ```txt
 * [✔] The provided message goes here!
 * ```
 */
export const renderSuccess = (message: string) => `${successCheckmarkTag} ${message}\n`

/**
 * @param message the message to set with the fail tag.
 * @returns the provided message prefixed by {@link failCrossTag}.
 *
 * ```txt
 * [✖] The provided message goes here!
 * ```
 */
export const renderFail = (message: string) => `${failCrossTag} ${message}\n`
