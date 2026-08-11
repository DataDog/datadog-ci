/**
 * Splits a user-supplied list of glob or regex patterns into individual patterns.
 *
 * Commas at brace depth 0 and newlines are separators. Commas inside a brace group are not,
 * so that brace expansion (`**\/*.{js,ts}`) and bounded regex quantifiers (`.{2,4}`) survive
 * the split. Unbalanced braces fall back to a plain comma split.
 *
 * Unlike `parsePathsList` in `./glob`, patterns are never expanded against the local
 * filesystem: they are meant to be interpreted elsewhere and must be preserved verbatim.
 */
export const splitPatternList = (value: string | undefined): string[] => {
  if (!value) {
    return []
  }

  const braceAware = hasBalancedBraces(value)

  const patterns: string[] = []
  let current = ''
  let depth = 0

  for (const char of value) {
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
    }

    if (char === '\n' || char === '\r' || (char === ',' && (!braceAware || depth === 0))) {
      patterns.push(current)
      current = ''
    } else {
      current += char
    }
  }
  patterns.push(current)

  return patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0)
}

const hasBalancedBraces = (value: string): boolean => {
  let depth = 0
  for (const char of value) {
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth < 0) {
        return false
      }
    }
  }

  return depth === 0
}
