import type {Environment, Measures, Tags} from './types'

export const cleanTags = (tags: Tags, limited = true, onInvalid?: () => void): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (!key || value === undefined) {
      continue
    }
    if (typeof value !== 'string') {
      onInvalid?.()
      continue
    }
    if (limited && (Object.keys(result).length >= 100 || key.length >= 300)) {
      continue
    }
    const text = value.trim()
    if (text) {
      result[key] = limited ? text.slice(0, 300 - key.length) : text
    }
  }

  return result
}

export const cleanMeasures = (measures: Measures, onInvalid?: () => void): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(measures)) {
    if (value === undefined) {
      continue
    }
    if (!key || typeof value !== 'number' || !Number.isFinite(value)) {
      onInvalid?.()
      continue
    }
    if (Object.keys(result).length < 100) {
      result[key] = value
    }
  }

  return result
}

export const warn = (
  callback: ((message: string) => void) | undefined,
  message: string,
  env: Environment = process.env
): void => {
  try {
    const level = env.DD_CI_VISIBILITY_WARNING_LEVEL?.toLowerCase()
    const log =
      callback ?? (level === 'off' ? undefined : level === 'info' || level === 'debug' ? console[level] : console.warn)
    log?.(`CI Visibility: ${message}`)
  } catch {
    // Diagnostic callbacks must not affect instrumented work.
  }
}
