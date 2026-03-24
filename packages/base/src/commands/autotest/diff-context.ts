import {exec} from 'child_process'
import {promisify} from 'util'

import {getGitHubEventPayload} from '../../helpers/utils'

const execAsync = promisify(exec)

export interface DiffContext {
  baseSha: string
  headSha: string
  provider: string
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

  return {baseSha, headSha, provider: 'GitHub Actions'}
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

  return {baseSha, headSha, provider: 'GitLab CI'}
}

export const detectDiffContext = (): DiffContext | undefined => {
  return getGitHubDiffContext() ?? getGitLabDiffContext()
}

export const getDiff = async (diffContext: DiffContext): Promise<string> => {
  const {baseSha, headSha} = diffContext

  // Fetch the base commit in case of a shallow clone (common in CI).
  await execAsync(`git fetch --depth=1 origin ${baseSha}`).catch(() => {
    // Ignore fetch errors — the commit may already be available locally.
  })

  const {stdout: diff} = await execAsync(`git diff ${baseSha}...${headSha}`, {
    maxBuffer: 50 * 1024 * 1024, // 50 MB
  })

  return diff
}
