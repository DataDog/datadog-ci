import {blueBright, bold, cyan, hex, red, underline, yellow} from 'chalk'
import ora from 'ora'

import {InstrumentCommand} from './instrument'
import {UninstrumentCommand} from './uninstrument'

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
 * @returns a message indicating that no default region has been specified.
 *
 * ```txt
 * [Error] No default region specified. Use `-r`, `--region`.'
 * ```
 */
export const renderNoDefaultRegionSpecifiedError = () =>
  renderError('No default region specified. Use `-r`, `--region`.')

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
 * @param error an error message or an object of type `unknown`*.
 * @returns the provided error prefixed by {@link errorTag}.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [Error] The provided error goes here!
 * ```
 */
export const renderError = (error: unknown) => `${errorTag} ${error}\n`

/**
 * @param warning the message to warn about
 * @returns the provided warning prefixed by {@link warningTag}.
 *
 * ```txt
 * [Warning] The provided warning goes here!
 * ```
 */
export const renderWarning = (warning: string) => `${warningTag} ${warning}\n`

/**
 * @param warning the message to warn about
 * @returns the provided warning prefixed by {@link warningExclamationSignTag}.
 *
 * ```txt
 * [!] The provided warning goes here!
 * ```
 */
export const renderSoftWarning = (warning: string) => `${warningExclamationSignTag} ${warning}\n`

/**
 * @param sourceCodeIntegrationError the error encountered when trying to enable source code integration.
 * @returns a warning message, with the source code integration error attached.
 *
 * ```txt
 * [Warning] Couldn't add source code integration. The provided error goes here!
 * ```
 */
export const renderSourceCodeIntegrationWarning = (sourceCodeIntegrationError: unknown) =>
  `\n${renderWarning(`Couldn't add source code integration. ${sourceCodeIntegrationError}.`)}`

/**
 * @returns a message suggesting to instrument in dev or staging environment first.
 *
 * ```txt
 * [Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run `uninstrument` with the same arguments to revert the changes.
 * ```
 */
export const renderInstrumentInStagingFirst = () =>
  `\n${renderWarning(
    `Instrument your ${hex('#FF9900').bold(
      'Lambda'
    )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
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
 * @returns a message indicating that no AWS credentials where found.
 *
 * ```txt
 * [!] No AWS credentials found, lets set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
 * ```
 */
export const renderNoAWSCredentialsFound = () =>
  `${renderSoftWarning(
    "No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI."
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
    } not been configured. Learn more about Datadog unified service tagging: ${underline(
      blueBright('https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment')
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
export const renderFetchedLambdaFunctions = (functionsLength: number) =>
  `Fetched ${bold(functionsLength)} ${hex('#FF9900').bold('Lambda')} functions.\n`

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
  `${bold(`[${region}]`)} Fetched ${bold(configsLength)} ${hex('#FF9900').bold('Lambda')} configurations.\n`

/**
 * @param functionsLength the number of Lambda functions that were updated.
 * @returns a message indicating that it updated Lambda functions.
 *
 * ```txt
 * Updated 42 Lambda functions.
 * ```
 */
export const renderUpdatedLambdaFunctions = (functionsLength: number) =>
  `Updated ${bold(functionsLength)} ${hex('#FF9900').bold('Lambda')} functions.\n`

/**
 * @returns a message indicating that it failed to fetch Lambda functions.
 *
 * ```txt
 * Failed fetching Lambda functions.
 * ```
 */
export const renderFailedFetchingLambdaFunctions = () =>
  `Failed fetching ${hex('#FF9900').bold('Lambda')} configurations.\n`

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
  `${bold(`[${region}]`)} Failed fetching ${hex('#FF9900').bold('Lambda')} configurations.\n`

/**
 * @returns a message indicating that it failed to update Lambda functions.
 *
 * ```txt
 * Failed updating Lambda functions.
 * ```
 */
export const renderFailedUpdatingLambdaFunctions = () => `Failed updating ${hex('#FF9900').bold('Lambda')} functions.\n`

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
    text: `Fetching ${hex('#FF9900').bold('Lambda')} functions.\n`,
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
    text: `${bold(`[${region}]`)} Fetching ${hex('#FF9900').bold('Lambda')} configurations.\n`,
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
    text: `Updating ${bold(functions)} ${hex('#FF9900').bold('Lambda')} functions.\n`,
  })

export const dryRunTag = bold(cyan('[Dry Run]'))
export const errorTag = bold(red('[Error]'))
export const warningTag = bold(yellow('[Warning]'))

export const warningExclamationSignTag = bold(yellow('[!]'))
