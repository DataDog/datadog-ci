import chalk from 'chalk'
import {GoogleAuth} from 'google-auth-library'
const printDiffModule = import('print-diff')

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
export const checkAuthentication = async () => {
  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (_) {
    return false
  }
}

/**
 * Recursively sort object keys to ensure consistent ordering
 */
const sortObjectKeys = (obj: any): any => {
  if (!obj) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  if (typeof obj === 'object') {
    const sorted: any = {}
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = sortObjectKeys(obj[key])
      })

    return sorted
  }

  return obj
}

/**
 * Obfuscate sensitive values in a line if it contains a key with "_KEY"
 */
const obfuscateSensitiveValues = (line: string): string => {
  // Match hex strings of 16, 32, or 64 characters (common API key/token lengths)
  return line
    .replace(/("[0-9a-fA-F]{16}"|"[0-9a-fA-F]{32}"|"[0-9a-fA-F]{64}")/g, '"***"')
    .replace(/('[0-9a-fA-F]{16}'|'[0-9a-fA-F]{32}'|'[0-9a-fA-F]{64}')/g, "'***'")
}

/**
 * Print a git diff-style comparison between two configurations
 * TODO(@nhulston): update Lambda and AAS instrument to show this diff
 * @param original The original configuration object
 * @param updated The updated configuration object
 * @returns A formatted diff string with colors
 */
export const printConfigDiff = async (original: any, updated: any): Promise<void> => {
  // Sort keys consistently before comparison
  const sortedOriginal = sortObjectKeys(original)
  const sortedUpdated = sortObjectKeys(updated)

  const originalJson = JSON.stringify(sortedOriginal, undefined, 2)
  const updatedJson = JSON.stringify(sortedUpdated, undefined, 2)

  // If they're identical after sorting, no changes
  if (originalJson === updatedJson) {
    console.log(chalk.gray('No changes detected.'))

    return
  }

  // Apply obfuscation to sensitive values before diffing
  const obfuscatedOriginal = originalJson.split('\n').map(obfuscateSensitiveValues).join('\n')
  const obfuscatedUpdated = updatedJson.split('\n').map(obfuscateSensitiveValues).join('\n')

  const {printUnifiedDiff} = await printDiffModule
  printUnifiedDiff(obfuscatedOriginal, obfuscatedUpdated)
}
