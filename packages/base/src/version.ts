import type {Logger} from './helpers/logger'

import chalk from 'chalk'

import {version} from '@datadog/datadog-ci-base/package.json'

import {SKIP_VERSION_BANNER_ENV_VAR} from './constants'
import {toBoolean} from './helpers/env'

export const cliVersion = version

/**
 * Logs the version in all commands, except version commands. Routed through the
 * logger so it respects `--log-format` (a JSON line in JSON mode, dim text otherwise).
 *
 * Suppressed entirely when `DD_CI_SKIP_VERSION_BANNER` is `1`/`true`, for callers
 * that find the per-invocation banner too noisy.
 */
export const printVersion = (logger: Logger) => {
  if (toBoolean(process.env[SKIP_VERSION_BANNER_ENV_VAR])) {
    return
  }

  const lastArg = process.argv.at(-1)
  const skipVersion = lastArg === '--version' || lastArg === 'version' || lastArg === '--help'
  if (skipVersion) {
    return
  }

  const banner = `datadog-ci v${cliVersion}`
  logger.info(logger.isJsonOutput() ? banner : chalk.dim(banner))
}
