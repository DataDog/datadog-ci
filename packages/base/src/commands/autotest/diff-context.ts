import {exec} from 'child_process'
import {promisify} from 'util'

import {getGitHubEventPayload} from '../../helpers/utils'

const execAsync = promisify(exec)

export interface PrInfo {
  repo: string // e.g. "DataDog/dd-go"
  number: number
}

export interface DiffContext {
  baseSha: string
  headSha: string
  provider: string
  pr?: PrInfo
}

const getGitHubDiffContext = (): DiffContext | undefined => {
  const eventPayload = getGitHubEventPayload()
  if (!eventPayload?.pull_request) {
    return undefined
  }

  const baseSha = eventPayload.pull_request.base?.sha
  const headSha = eventPayload.pull_request.head?.sha
  if (!baseSha || !headSha) {
    return undefined
  }

  const pr =
    process.env.GITHUB_REPOSITORY && eventPayload.pull_request.number
      ? {repo: process.env.GITHUB_REPOSITORY, number: eventPayload.pull_request.number}
      : undefined

  return {baseSha, headSha, provider: 'GitHub Actions', pr}
}

const getGitLabDiffContext = (): DiffContext | undefined => {
  if (!process.env.GITLAB_CI) {
    return undefined
  }

  const baseSha = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA
  const headSha = process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA
  if (!baseSha || !headSha) {
    return undefined
  }

  const prNumber = process.env.CI_MERGE_REQUEST_IID ? parseInt(process.env.CI_MERGE_REQUEST_IID, 10) : undefined
  const pr =
    process.env.CI_PROJECT_PATH && prNumber ? {repo: process.env.CI_PROJECT_PATH, number: prNumber} : undefined

  return {baseSha, headSha, provider: 'GitLab CI', pr}
}

export const detectDiffContext = (): DiffContext | undefined => {
  return getGitHubDiffContext() ?? getGitLabDiffContext()
}

export const getDiff = async (diffContext: DiffContext): Promise<string> => {
  const {baseSha, headSha} = diffContext
  const cwd = process.env.AUTOTEST_REPO_DIR || undefined

  // Fetch the base commit in case of a shallow clone (common in CI).
  await execAsync(`git fetch --depth=1 origin ${baseSha}`, {cwd}).catch(() => {
    // Ignore fetch errors — the commit may already be available locally.
  })

  const {stdout: diff} = await execAsync(`git diff ${baseSha}...${headSha}`, {
    maxBuffer: 50 * 1024 * 1024, // 50 MB
    cwd,
  })

  return diff
}
