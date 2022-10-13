import {bold, cyan, hex} from 'chalk'
import ora from 'ora'
import {InstrumentCommand} from './instrument'
import {UninstrumentCommand} from './uninstrument'

/**
 * Prints a header to indicate the user which `lambda` subcommand is running.
 * 
 * @param command current selected lambda subcommand.
 * 
 * ```sh
 * [Dry Run] 🐶 Instrumenting Lambda function
 * ```
 */
export const printCommandHeader = (command: InstrumentCommand | UninstrumentCommand) => {
  const prefix = command.dryRun ? dryRunTag : ''

  let leadingWord = 'Instrumenting'
  if (command instanceof UninstrumentCommand) {
    leadingWord = 'Uninstrumenting'
  }
  command.context.stdout.write(`\n${prefix}🐶 ${leadingWord} Lambda function\n`)
}

/**
 * Returns a spinner instance with text for lambda functions fetching.
 * 
 * @returns an instance of an `ora` spinner.
 * 
 * ```sh
 * ⠋ Fetching Lambda functions.
 * ```
 */
export const fetchingFunctionsSpinner = () =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `Fetching ${hex('#FF9900').bold('Lambda')} functions.\n`,
  })

/**
 * Returns a spinner instance with text for lambda configurations fetching.
 * 
 * @returns an instance of an `ora` spinner.
 * 
 * ```sh
 * ⠋ [us-east-1] Fetching Lambda configurations.
 * ```
 */
export const fetchingFunctionsConfigSpinner = (region: string) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `${bold(`[${region}]`)} Fetching ${hex('#FF9900').bold('Lambda')} configurations.\n`,
  })

/**
 * Returns a spinner instance with text for lambda functions updating.
 * 
 * @returns an instance of an `ora` spinner.
 * 
 * ```sh
 * ⠋ Updating 5 Lambda functions.
 * ```
 */
export const updatingFunctionsSpinner = (functions: number) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `Updating ${bold(functions)} ${hex('#FF9900').bold('Lambda')} functions.\n`,
  })

export const dryRunTag = bold(cyan('[Dry Run]'))
