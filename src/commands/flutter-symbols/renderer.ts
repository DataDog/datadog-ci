import chalk from 'chalk'
import {ICONS} from '../../helpers/formatting'

export const renderArgumentMissingError = (argumentName: String) =>
  chalk.red(`${ICONS.FAILED} Error: parameter "${argumentName}" is required.\n`)

export const renderDartSymbolsLocationRequiredError = () =>
  chalk.red(`${ICONS.FAILED} Error: specifying "--dart-symbols" requires specifying "--dart-symbol-location"\n`)
