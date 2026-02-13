import {renderError, renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'

/**
 * @returns a message indicating that no default region has been specified.
 *
 * ```txt
 * [Error] No default region specified. [-r,--region]'
 * ```
 */
export const renderNoDefaultRegionSpecifiedError = () => renderError('No default region specified. [-r,--region]')

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
