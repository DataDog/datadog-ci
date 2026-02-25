import chalk from 'chalk'

import {renderSoftWarning} from '../renderer'

interface Resource {
  subscriptionId: string
  resourceGroup: string
  name: string
  subType?: string
  subResourceName?: string
}

export const parseResourceId = (resourceId: string): Resource | undefined => {
  const match = resourceId.match(
    /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.\w+\/\w+\/([^/]+)(?:\/(\w+)\/([^/]+))?$/i
  )
  if (match) {
    const [, subscriptionId, resourceGroup, name, subType, subResourceName] = match

    return {subscriptionId, resourceGroup, name, subType, subResourceName}
  }
}

// Type stubs for Azure SDK types (to avoid importing @azure packages)
interface AzureCredential {
  getToken(scopes: string | string[]): Promise<{token: string} | null>
}
interface AzureError {
  name?: string
}
/**
 * Ensures Azure authentication is working by attempting to get a token.
 * @param print - Function to print messages
 * @param cred - Azure credential object with getToken method
 * @returns true if authentication succeeds, false otherwise
 */

export const ensureAzureAuth = async (print: (arg: string) => void, cred: AzureCredential): Promise<boolean> => {
  try {
    await cred.getToken('https://management.azure.com/.default')
  } catch (error) {
    print(
      renderSoftWarning(
        `Failed to authenticate with Azure: ${(error as AzureError).name}\n\nPlease ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run ${chalk.bold(
          'az login'
        )} to authenticate.\n`
      )
    )

    return false
  }

  return true
} /**
 * Formats an error (usually an Azure RestError) object into a string for display.
 * @param error - Error object to format
 * @returns Formatted error string
 */
// no-dd-sa:typescript-best-practices/no-explicit-any

export const formatError = (error: any): string => {
  const errorType = error.code ?? error.name
  const errorMessage = error.details?.message ?? error.message

  return errorType && errorMessage ? `${errorType}: ${errorMessage}` : String(error)
}
