import {getGitHubEventPayload} from '../../helpers/utils'

export interface PrInfo {
  repo: string // e.g. "DataDog/dd-go"
  number: number
}

export interface DiffContext {
  provider: string
  pr?: PrInfo
}

const getGitHubDiffContext = (): DiffContext | undefined => {
  const eventPayload = getGitHubEventPayload()
  if (!eventPayload?.pull_request) {
    return undefined
  }

  const pr =
    process.env.GITHUB_REPOSITORY && eventPayload.pull_request.number
      ? {repo: process.env.GITHUB_REPOSITORY, number: eventPayload.pull_request.number}
      : undefined

  return {provider: 'GitHub Actions', pr}
}

const getGitLabDiffContext = (): DiffContext | undefined => {
  if (!process.env.GITLAB_CI) {
    return undefined
  }

  const prNumber = process.env.CI_MERGE_REQUEST_IID ? parseInt(process.env.CI_MERGE_REQUEST_IID, 10) : undefined
  const pr =
    process.env.CI_PROJECT_PATH && prNumber ? {repo: process.env.CI_PROJECT_PATH, number: prNumber} : undefined

  if (!pr) {
    return undefined
  }

  return {provider: 'GitLab CI', pr}
}

export const detectDiffContext = (): DiffContext | undefined => {
  return getGitHubDiffContext() ?? getGitLabDiffContext()
}
