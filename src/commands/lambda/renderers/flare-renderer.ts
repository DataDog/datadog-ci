import {dryRunTag, errorTag} from './common-renderer'

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
