import chalk from 'chalk'
import {GoogleAuth} from 'google-auth-library'

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
 * Compute LCS (Longest Common Subsequence) for Git-like diff matching
 */
const computeLCS = (a: string[], b: string[]): number[][] => {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array(m + 1)
    .fill(undefined)
    .map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].trimEnd() === b[j - 1].trimEnd()) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp
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
 * Generate diff operations from the LCS table
 */
const computeDiff = (
  originalLines: string[],
  updatedLines: string[]
): {type: 'add' | 'remove' | 'context'; line: string}[] => {
  const result: {type: 'add' | 'remove' | 'context'; line: string}[] = []
  const lcs = computeLCS(originalLines, updatedLines)

  let i = originalLines.length
  let j = updatedLines.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1].trimEnd() === updatedLines[j - 1].trimEnd()) {
      result.unshift({type: 'context', line: originalLines[i - 1]})
      i--
      j--
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      result.unshift({type: 'add', line: updatedLines[j - 1]})
      j--
    } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
      result.unshift({type: 'remove', line: originalLines[i - 1]})
      i--
    }
  }

  return result
}

/**
 * Generate a git diff-style comparison between two configurations
 * TODO(@nhulston): update Lambda and AAS instrument to show this diff
 * @param original The original configuration object
 * @param updated The updated configuration object
 * @returns A formatted diff string with colors
 */
export const generateConfigDiff = (original: any, updated: any): string => {
  // Sort keys consistently before comparison
  const sortedOriginal = sortObjectKeys(original)
  const sortedUpdated = sortObjectKeys(updated)

  const originalJson = JSON.stringify(sortedOriginal, undefined, 2)
  const updatedJson = JSON.stringify(sortedUpdated, undefined, 2)

  // If they're identical after sorting, no changes
  if (originalJson === updatedJson) {
    return chalk.gray('No changes detected.\n')
  }

  const originalLines = originalJson.split('\n')
  const updatedLines = updatedJson.split('\n')

  const diff = computeDiff(originalLines, updatedLines)

  // Group consecutive changes into hunks
  const result: string[] = []
  let i = 0

  while (i < diff.length) {
    const current = diff[i]

    if (current.type === 'context') {
      result.push(`  ${obfuscateSensitiveValues(current.line)}`)
      i++
    } else {
      // Collect all consecutive changes
      const removals: string[] = []
      const additions: string[] = []

      while (i < diff.length && diff[i].type !== 'context') {
        if (diff[i].type === 'remove') {
          removals.push(diff[i].line)
        } else if (diff[i].type === 'add') {
          additions.push(diff[i].line)
        }
        i++
      }

      // Output all removals first, then all additions (with sensitive value obfuscation)
      removals.forEach((line) => result.push(chalk.red(`- ${obfuscateSensitiveValues(line)}`)))
      additions.forEach((line) => result.push(chalk.green(`+ ${obfuscateSensitiveValues(line)}`)))
    }
  }

  return result.join('\n') + '\n'
}
