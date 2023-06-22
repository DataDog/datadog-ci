import {dryRunTag} from './common-renderer'

/**
 * @returns a header indicating which `lambda` subcommand is running.
 * @param isDryRun whether or not the command is a dry run.
 *
 * ```txt
 * [Dry Run] 🐶 Instrumenting Lambda function
 * ```
 */
export const renderLambdaFlareHeader = (isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  return `\n${prefix}🐶 Generating Lambda flare to send your configuration to Datadog...\n`
}
