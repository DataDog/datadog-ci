import type {Logger} from './helpers/logger'

import chalk from 'chalk'

import {version} from '@datadog/datadog-ci-base/package.json'

export const cliVersion = version

/**
 * Logs the version in all commands, except version commands. Routed through the
 * logger so it respects `--log-format` (a JSON line in JSON mode, dim text otherwise).
 */
export const printVersion = (logger: Logger) => {
  const isVersionCommand = process.argv.at(-1) === '--version' || process.argv.at(-1) === 'version'
  if (!isVersionCommand) {
    const banner = `datadog-ci v${cliVersion}`
    logger.info(logger.isJsonOutput() ? banner : chalk.dim(banner))
  }
}
