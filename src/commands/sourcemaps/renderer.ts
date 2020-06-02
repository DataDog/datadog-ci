import chalk from 'chalk'
import {Payload} from './interfaces'

const ICONS = {
  FAILED: chalk.bold.red('✖'),
}

export const renderFailedUpload = (payload: Payload) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.red(` ${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}\n`)
}

export const renderRetriedUpload = (payload: Payload, attempt: number) => {
  const sourcemapPathBold = `[${chalk.bold.dim(payload.sourcemapPath)}]`

  return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}\n`)
}
