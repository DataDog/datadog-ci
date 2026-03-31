import chalk from 'chalk'

import {version as cliVersion} from '@datadog/datadog-ci-base/package.json'

/**
 * Prints version in all commands, except version commands.
 */
export const printVersion = () => {
  const isVersionCommand = process.argv.at(-1) === '--version' || process.argv.at(-1) === 'version'
  if (!isVersionCommand) {
    process.stdout.write(chalk.dim(`datadog-ci v${cliVersion}\n`))
  }
}

export {cliVersion}
