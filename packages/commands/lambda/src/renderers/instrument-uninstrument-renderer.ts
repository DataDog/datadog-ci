import chalk from 'chalk'
import ora from 'ora'

import {
  dryRunTag,
  warningTag,
  successCheckmarkTag,
  failCrossTag,
  renderError,
  renderSoftWarning,
} from '../../../helpers/renderer'

import {InstrumentCommand} from '../instrument'
import {UninstrumentCommand} from '../uninstrument'

/**
 * @returns a header indicating which `lambda` subcommand is running.
 * @param command current selected lambda subcommand.
 *
 * ```txt
 * [Dry Run] 🐶 Instrumenting Lambda function
 * ```
 */
export const renderLambdaHeader = (commandType: InstrumentCommand | UninstrumentCommand, isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  let commandVerb = 'Instrumenting'
  if (commandType === UninstrumentCommand.prototype) {
    commandVerb = 'Uninstrumenting'
  }

  return `\n${prefix}🐶 ${commandVerb} Lambda function\n`
}

/**
 * @param commandType the type of command being used.
 * @returns a message indicating that no functions are specified depending on the given command.
 *
 * ```txt
 * [Error] No functions specified for instrumentation.
 * or
 * [Error] No functions specified for uninstrumentation.
 * ```
 */
export const renderNoFunctionsSpecifiedError = (commandType: InstrumentCommand | UninstrumentCommand) => {
  let commandWords = 'instrument'
  if (commandType === UninstrumentCommand.prototype) {
    commandWords = 'remove instrumentation'
  }

  return renderError(`No functions specified to ${commandWords}.`)
}

/**
 * @returns a message indicating that both options `--extensionVersion` and `--forwarder` are set.
 *
 * ```txt
 * [Error] "extensionVersion" and "forwarder" should not be used at the same time.
 * ```
 */
export const renderExtensionAndForwarderOptionsBothSetError = () =>
  renderError('"extensionVersion" and "forwarder" should not be used at the same time.')

/**
 * @returns a message indicating that the environment variable `DATADOG_API_KEY` is missing.
 *
 * ```txt
 * [Error] Missing DATADOG_API_KEY in your environment.
 * ```
 */
export const renderMissingDatadogApiKeyError = () => renderError('Missing DATADOG_API_KEY in your environment.')

/**
 * @param functionsCommandUsed a boolean indicating which command was used for the specified functions.
 * @returns a message indicating that option `--functions-regex`
 * is being used along with either `--functions` or the parameter
 * `functions` in a config file.
 *
 * ```txt
 * [Error] "--functions" and "--functions-regex" should not be used at the same time.
 * or
 * [Error] Functions in config file and "--functions-regex" should not be used at the same time.
 * ```
 */
export const renderFunctionsAndFunctionsRegexOptionsBothSetError = (functionsCommandUsed: boolean) => {
  const usedCommand = functionsCommandUsed ? '"--functions"' : 'Functions in config file'

  return renderError(`${usedCommand} and "--functions-regex" should not be used at the same time.`)
}

/**
 * @returns a message indicating that `--functions-regex` argument contains `:` which is mainly used with ARNs.
 *
 * ```txt
 * [Error] "--functions-regex" isn't meant to be used with ARNs.
 * ```
 */
export const renderRegexSetWithARNError = () => renderError(`"--functions-regex" isn't meant to be used with ARNs.`)

/**
 * @param error an error message or an object of type `unknown`*.
 * @returns a message indicating that an error occurred while grouping functions.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [Error] Couldn't group functions. The provided error goes here!
 * ```
 */
export const renderCouldntGroupFunctionsError = (error: unknown) => renderError(`Couldn't group functions. ${error}`)

/**
 * @param error an error message or an object of type `unknown`*.
 * @returns a message indicating that an error occurred while updating.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [Error] Failure during update. The provided error goes here!
 * ```
 */
export const renderFailureDuringUpdateError = (error: unknown) => renderError(`Failure during update. ${error}`)

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

/**
 * @param sourceCodeIntegrationError the error encountered when trying to enable source code integration.
 * @returns a warning message, with the source code integration error attached.
 *
 * ```txt
 * [Warning] Couldn't add source code integration. The provided error goes here!
 * ```
 */
export const renderSourceCodeIntegrationWarning = (sourceCodeIntegrationError: unknown) =>
  `\n${renderWarning(`Couldn't add source code integration, continuing without it. ${sourceCodeIntegrationError}.`)}`

/**
 * @returns a message suggesting to instrument in dev or staging environment first.
 *
 * ```txt
 * [Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run `uninstrument` with the same arguments to revert the changes.
 * ```
 */
export const renderInstrumentInStagingFirst = () =>
  `\n${renderWarning(
    `Instrument your ${chalk
      .hex('#FF9900')
      .bold(
        'Lambda'
      )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${chalk.bold(
      'uninstrument'
    )}\` with the same arguments to revert the changes.`
  )}`

/**
 * @returns a soft warning message indicating that functions are going to be updated.
 *
 * ```txt
 * Functions to be updated:
 * ```
 */
export const renderFunctionsToBeUpdated = () => `\n${renderSoftWarning('Functions to be updated:')}`

/**
 * @returns a warning message reminding the user to lock versions for production.
 *
 * ```txt
 *    [Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using `--layerVersion` and `--extensionVersion`.
 * ```
 */
export const renderEnsureToLockLayerVersionsWarning = () =>
  `\t${renderWarning(
    'At least one latest layer version is being used. Ensure to lock in versions for production applications using `--layerVersion` and `--extensionVersion`.'
  )}`

/**
 * @returns a message indicating to configure AWS region.
 *
 * ```txt
 * [!] Configure AWS region.
 * ```
 */
export const renderConfigureAWSRegion = () => `\n${renderSoftWarning('Configure AWS region.')}`

/**
 * @returns a message indicating to configure Datadog settings.
 *
 * ```txt
 * [!] Configure Datadog settings.
 * ```
 */
export const renderConfigureDatadog = () => `\n${renderSoftWarning('Configure Datadog settings.')}`

/**
 * @returns a message indicating that no Lambda functions were found
 * in the specified region.
 *
 * ```txt
 * [Error] Couldn't find any Lambda functions in the specified region.
 * ```
 */
export const renderCouldntFindLambdaFunctionsInRegionError = () =>
  renderError("Couldn't find any Lambda functions in the specified region.")

/**
 * @param error an error message or an object of type `unknown`*.
 * @returns a message indicating that no Lambda functions were fetched.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [Error] Couldn't fetch Lambda functions. The provided error goes here!
 * ```
 */
export const renderCouldntFetchLambdaFunctionsError = (error: unknown) =>
  renderError(`Couldn't fetch Lambda functions. ${error}`)

/**
 * @param tagsMissing an array containing the tags that are not configured
 * @returns a message indicating which tags are not configured and where to
 * learn more about Datadog's unified service tagging.
 *
 * ```txt
 * [Warning] The service tag has not been configures. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.
 * ```
 */
export const renderTagsNotConfiguredWarning = (tagsMissing: string[]) => {
  const tags = tagsMissing.join(', ').replace(/, ([^,]*)$/, ' and $1')
  const plural = tagsMissing.length > 1

  return `\n${renderWarning(
    `The ${tags} tag${
      plural ? 's have' : ' has'
    } not been configured. Learn more about Datadog unified service tagging: ${chalk.underline(
      chalk.blueBright(
        'https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment'
      )
    )}.`
  )}`
}

/**
 * @returns a message indicating that the extra tags provided do not comply
 * with the <key>:<value> array standard.
 *
 * ```txt
 * [Error] Extra tags do not comply with the <key>:<value> array.
 * ```
 */
export const renderExtraTagsDontComplyError = () =>
  renderError('Extra tags do not comply with the <key>:<value> array.')

/**
 * @returns a message indicating that the `--layerVersion` argument provided is invalid.
 *
 * ```txt
 * [Error] Invalid layer version "provided value".
 * ```
 */
export const renderInvalidLayerVersionError = (layerVersion?: string) =>
  renderError(`Invalid layer version "${layerVersion}".`)

/**
 * @returns a message indicating that the `--extensionVersion` argument provided is invalid.
 *
 * ```txt
 * [Error] Invalid extension version "provided value".
 * ```
 */
export const renderInvalidExtensionVersionError = (extensionVersion?: string) =>
  renderError(`Invalid extension version "${extensionVersion}".`)

/**
 * @returns a message indicating that the provided argument for a specific string boolean
 * field was invalid.
 *
 * ```txt
 * [Error] Invalid boolean specified for "string boolean field".
 * ```
 */
export const renderInvalidStringBooleanSpecifiedError = (stringBoolean: string) =>
  renderError(`Invalid boolean specified for ${stringBoolean}.`)

/**
 * @param isDryRun a boolean to define if a prefix should be added.
 * @returns a message indicating that no updates will be applied.
 *
 * ```txt
 * [Dry Run] No updates will be applied.
 * or
 * No updates will be applied.
 * ```
 */
export const renderNoUpdatesApplied = (isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  return `\n${prefix}No updates will be applied.\n`
}

/**
 * @param isDryRun a boolean to define if a prefix should be added.
 * @returns a message indicating that updates will be applied.
 *
 * ```txt
 * [Dry Run] Will apply the following updates:
 * or
 * Will apply the following updates:
 * ```
 */
export const renderWillApplyUpdates = (isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  return `\n${prefix}Will apply the following updates:\n`
}

/**
 * @returns a soft warning message indicating that confirmation is needed.
 *
 * ```txt
 * [!] Confirmation needed.
 * ```
 */
export const renderConfirmationNeededSoftWarning = () => renderSoftWarning('Confirmation needed.')

/**
 * @returns a soft warning message indicating that functions are being instrumented.
 *
 * ```txt
 * [!] Instrumenting functions.
 * ```
 */
export const renderInstrumentingFunctionsSoftWarning = () => renderSoftWarning('Instrumenting functions.')

/**
 * @returns a soft warning message indicating the removal of instrumentation
 * for functions.
 *
 * ```txt
 * [!] Uninstrumenting functions.
 * ```
 */
export const renderUninstrumentingFunctionsSoftWarning = () => renderSoftWarning('Uninstrumenting functions.')

/**
 * @param functionsLength the number of Lambda functions that were fetched.
 * @returns a message indicating that it fetched Lambda functions.
 *
 * ```txt
 * Fetched 42 Lambda functions.
 * ```
 */
export const renderFetchedLambdaFunctions = (functionsLength: number) => {
  const plural = functionsLength > 1

  return `Fetched ${chalk.bold(functionsLength)} ${chalk.hex('#FF9900').bold('Lambda')} function${plural ? 's' : ''}.\n`
}

/**
 * @param region the AWS region where the Lambda configs belong to.
 * @param configsLength the number of Lambda configuration that were fetched.
 * @returns a message indicating that it updated Lambda functions.
 *
 * ```txt
 * [us-east-1] Fetched 42 Lambda configurations.
 * ```
 */
export const renderFetchedLambdaConfigurationsFromRegion = (region: string, configsLength: number) =>
  `${chalk.bold(`[${region}]`)} Fetched ${chalk.bold(configsLength)} ${chalk
    .hex('#FF9900')
    .bold('Lambda')} configurations.\n`

/**
 * @param functionsLength the number of Lambda functions that were updated.
 * @returns a message indicating that it updated Lambda functions.
 *
 * ```txt
 * Updated 42 Lambda functions.
 * ```
 */
export const renderUpdatedLambdaFunctions = (functionsLength: number) => {
  const plural = functionsLength > 1

  return `Updated ${chalk.bold(functionsLength)} ${chalk.hex('#FF9900').bold('Lambda')} function${plural ? 's' : ''}.\n`
}

/**
 * @param region the AWS region where the Lambda functions belong to.
 * @param functionsLength the number of Lambda functions that were updated.
 * @returns a message indicating that it updated Lambda functions from a certain region.
 *
 * ```txt
 * [us-east-1] Updated 42 Lambda functions.
 * ```
 */
export const renderUpdatedLambdaFunctionsFromRegion = (region: string, functionsLength: number) => {
  const plural = functionsLength > 1

  return `${chalk.bold(`[${region}]`)} Updated ${chalk.bold(functionsLength)} ${chalk
    .hex('#FF9900')
    .bold('Lambda')} function${plural ? 's' : ''}.\n`
}

/**
 * @returns a message indicating that it failed to fetch Lambda functions.
 *
 * ```txt
 * Failed fetching Lambda functions.
 * ```
 */
export const renderFailedFetchingLambdaFunctions = () =>
  `Failed fetching ${chalk.hex('#FF9900').bold('Lambda')} configurations.\n`

/**
 * @param region the AWS region where the Lambda configs belong to.
 * @returns a message indicating that it failed to fetch Lambda configurations.
 * from a region.
 *
 * ```txt
 * [us-east-1] Failed fetching Lambda configurations.
 * ```
 */
export const renderFailedFetchingLambdaConfigurationsFromRegion = (region: string) =>
  `${chalk.bold(`[${region}]`)} Failed fetching ${chalk.hex('#FF9900').bold('Lambda')} configurations.\n`

/**
 * @param f the Lambda function which failed to update.
 * @param error an error message or an object of type `unknown`*.
 * @returns a message indicating that it failed while updating the Lambda function,
 * and the given error.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [us-east-1] Failed updating ARN Provided error goes here..
 * ```
 */
export const renderFailedUpdatingLambdaFunction = (f: string, error: unknown) =>
  renderError(`Failed updating ${chalk.bold(f)} ${error}`)

/**
 * @returns a message indicating that it failed to update Lambda functions.
 *
 * ```txt
 * Failed updating Lambda functions.
 * ```
 */
export const renderFailedUpdatingLambdaFunctions = () =>
  `Failed updating ${chalk.hex('#FF9900').bold('Lambda')} functions.\n`

/**
 * @returns a message indicating that it failed to update all Lambda functions.
 *
 * ```txt
 * Failed updating every Lambda function.
 * ```
 */
export const renderFailedUpdatingEveryLambdaFunction = () =>
  `Failed updating every ${chalk.hex('#FF9900').bold('Lambda')} function.\n`

/**
 * @param region the AWS region where the Lambda configs belong to.
 * @returns a message indicating that it failed to update all Lambda functions
 * from the given region.
 *
 * ```txt
 * [us-east-1] Failed updating every Lambda function.
 * ```
 */
export const renderFailedUpdatingEveryLambdaFunctionFromRegion = (region: string) =>
  `${chalk.bold(`[${region}]`)} Failed updating every ${chalk.hex('#FF9900').bold('Lambda')} function.\n`

/**
 * Returns a spinner instance with text for lambda functions fetching.
 *
 * @returns an instance of an {@link ora} spinner.
 *
 * ```txt
 * ⠋ Fetching Lambda functions.
 * ```
 */
export const fetchingFunctionsSpinner = () =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `Fetching ${chalk.hex('#FF9900').bold('Lambda')} functions.\n`,
  })

/**
 * Returns a spinner instance with text for lambda configurations fetching.
 *
 * @returns an instance of {@link ora} spinner.
 *
 * ```txt
 * ⠋ [us-east-1] Fetching Lambda configurations.
 * ```
 */
export const fetchingFunctionsConfigSpinner = (region: string) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `${chalk.bold(`[${region}]`)} Fetching ${chalk.hex('#FF9900').bold('Lambda')} configurations.\n`,
  })

/**
 * Returns a spinner instance with text for lambda functions updating.
 *
 * @returns an instance of an {@link ora} spinner.
 *
 * ```txt
 * ⠋ Updating 5 Lambda functions.
 * ```
 */
export const updatingFunctionsSpinner = (functions: number) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `Updating ${chalk.bold(functions)} ${chalk.hex('#FF9900').bold('Lambda')} functions.\n`,
  })

/**
 * Returns a spinner instance with text for Lambda functions being updated
 * from the given region.
 *
 * @returns an instance of {@link ora} spinner.
 *
 * ```txt
 * ⠋ [us-east-1] Updating Lambda functions.
 * ```
 */
export const updatingFunctionsConfigFromRegionSpinner = (region: string, functions: number) =>
  ora({
    color: 'magenta',
    discardStdin: false,
    text: `${chalk.bold(`[${region}]`)} Updating ${chalk.bold(functions)} ${chalk
      .hex('#FF9900')
      .bold('Lambda')} functions.\n`,
  })
