import {createHash} from 'crypto'
import fs from 'fs'

import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {GIT_REPOSITORY_URL} from '@datadog/datadog-ci-base/helpers/tags'

export const validateFilePath = (filePath: string): boolean => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export const validateJsonStructure = (content: string): boolean => {
  try {
    JSON.parse(content)

    return true
  } catch {
    return false
  }
}

export const computeFileHash = (content: string): string => {
  const hash = createHash('sha256')
  hash.update(content)

  return hash.digest('hex')
}

/**
 * Resolve repo_id with the following priority:
 * 1. Explicit flag value (--repo-id)
 * 2. Environment variable (DD_GIT_REPOSITORY_URL or similar)
 * 3. Git metadata extracted from spanTags
 */
export const resolveRepoId = (flagValue: string | undefined, spanTags: SpanTags): string | undefined => {
  if (flagValue) {
    return flagValue
  }

  // Try environment variables
  const envRepoId = process.env.DD_GIT_REPOSITORY_URL || process.env.DD_REPOSITORY_URL
  if (envRepoId) {
    return envRepoId
  }

  // Fall back to git metadata
  return spanTags[GIT_REPOSITORY_URL]
}
