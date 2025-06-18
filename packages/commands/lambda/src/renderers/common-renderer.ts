import {renderError, renderSoftWarning} from '@datadog/datadog-ci-core/helpers/renderer'

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
