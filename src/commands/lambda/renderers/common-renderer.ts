import {bold, cyan, green, red, yellow} from 'chalk'

export const dryRunTag = bold(cyan('[Dry Run]'))
export const errorTag = bold(red('[Error]'))
export const warningTag = bold(yellow('[Warning]'))

export const warningExclamationSignTag = bold(yellow('[!]'))
export const successCheckmarkTag = bold(green('✔'))
export const failCrossTag = bold(red('✖'))

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
 * @param warning the message to warn about.
 * @returns the provided warning prefixed by {@link warningExclamationSignTag}.
 *
 * ```txt
 * [!] The provided warning goes here!
 * ```
 */
export const renderSoftWarning = (warning: string) => `${warningExclamationSignTag} ${warning}\n`

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
