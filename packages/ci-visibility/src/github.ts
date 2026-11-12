import {readdirSync, readFileSync} from 'node:fs'
import {join, posix, resolve, win32} from 'node:path'

import type {Environment, GithubContext} from './types'

interface WorkerMetadata {
  jobName?: string
  jobId?: string
  steps: {contextName?: string}[]
}

const compact = (values: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]))

/** Read only the requested JSON array, respecting brackets inside quoted strings. */
const readSteps = (content: string): WorkerMetadata['steps'] => {
  const jobMessage = content.indexOf('Job message:')
  if (jobMessage < 0) {
    return []
  }
  const key = content.indexOf('"steps"', jobMessage)
  const start = key < 0 ? -1 : content.indexOf('[', key)
  if (start < 0) {
    return []
  }
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < content.length; i++) {
    const character = content[i]
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === '[') {
      depth++
    } else if (character === ']' && --depth === 0) {
      const steps: unknown = JSON.parse(content.slice(start, i + 1))

      return Array.isArray(steps)
        ? (steps as unknown[]).map((step) => {
            if (typeof step !== 'object' || !step || !('contextName' in step) || typeof step.contextName !== 'string') {
              return {}
            }

            return {contextName: step.contextName}
          })
        : []
    }
  }

  return []
}

export const diagnosticRoots = (env: Environment): string[] => {
  const paths = env.RUNNER_OS === 'Windows' ? win32 : env.RUNNER_OS ? posix : {resolve, join}
  const roots = env.RUNNER_TEMP ? [paths.resolve(env.RUNNER_TEMP, '..', '..')] : []
  const home = env.HOME || env.USERPROFILE
  if (home) {
    roots.push(home, paths.join(home, 'actions-runner'))
  }
  roots.push(...(env.RUNNER_OS === 'Windows' ? ['C:\\actions-runner'] : ['/home/runner', '/opt/actions-runner']))

  return [...new Set(roots)]
}

// Runner versions can namespace _diag under one or two intermediate directories.
const diagnosticDirectories = (root: string, depth = 2): string[] => {
  const directories = [join(root, '_diag')]
  if (depth > 0) {
    try {
      for (const entry of readdirSync(root, {withFileTypes: true})) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !['_work', '_diag', 'node_modules'].includes(entry.name)
        ) {
          directories.push(...diagnosticDirectories(join(root, entry.name), depth - 1))
        }
      }
    } catch {
      // Missing or unreadable layouts are normal on other runner platforms.
    }
  }

  return directories
}

const workerMetadata = (env: Environment): WorkerMetadata => {
  const logs: string[] = []
  for (const root of diagnosticRoots(env)) {
    for (const directory of new Set(diagnosticDirectories(root))) {
      try {
        logs.push(
          ...readdirSync(directory, {withFileTypes: true})
            .filter((entry) => entry.isFile() && /^Worker_.*\.log$/.test(entry.name))
            .map((entry) => join(directory, entry.name))
        )
      } catch {
        // Try the next candidate without exposing runner paths or log contents.
      }
    }
    if (logs.length) {
      break
    }
  }
  logs.sort((a, b) => b.split(/[\\/]/).pop()!.localeCompare(a.split(/[\\/]/).pop()!))
  for (const file of logs) {
    try {
      const content = readFileSync(file, 'utf8')
      if (
        env.ACTIONS_ORCHESTRATION_ID &&
        (!content.includes('"system.orchestrationId"') ||
          !content.includes(JSON.stringify(env.ACTIONS_ORCHESTRATION_ID)))
      ) {
        continue
      }
      const encodedName = content.match(/"jobDisplayName":\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      const steps = readSteps(content)
      if (!encodedName) {
        continue
      }

      return {
        jobName: JSON.parse(`"${encodedName}"`) as string,
        jobId: content.match(/"job":\s*{[\s\S]*?"v"\s*:\s*(\d+)(?:\.0)?/)?.[1],
        steps,
      }
    } catch {
      // A partial worker log must not prevent recording other annotations.
    }
  }

  return {steps: []}
}

const normalizeRef = (ref = ''): string => ref.replace(/^(refs\/(heads|tags)\/|origin\/)/, '')

const sanitizeRepositoryUrl = (remote: string | undefined): string | undefined => {
  if (!remote || /^git@[^:@/?#\s]+:[^?#\s]+$/.test(remote)) {
    return remote
  }
  try {
    const url = new URL(remote)
    if (!url.hostname) {
      return undefined
    }
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''

    return url.toString()
  } catch {
    // Omit malformed URLs rather than risking credentials in telemetry.
    return undefined
  }
}

export const createGithubContext = (env: Environment): (() => GithubContext) => {
  let metadata: WorkerMetadata | undefined
  let event: {pull_request?: {number?: number; head?: {sha?: string}; base?: {sha?: string}}} | undefined
  let eventRead = false

  return () => {
    if (!metadata) {
      metadata = workerMetadata(env)
    }
    if (!eventRead) {
      eventRead = true
      try {
        event = env.GITHUB_EVENT_PATH
          ? (JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as typeof event)
          : undefined
      } catch {
        // Metadata from the environment remains usable without an event file.
      }
    }
    const server = env.GITHUB_SERVER_URL || 'https://github.com'
    const runId = env.GITHUB_RUN_ID
    const attempt = env.GITHUB_RUN_ATTEMPT || '1'
    const repository = env.GITHUB_REPOSITORY
    const jobName = env.DD_GITHUB_JOB_NAME || metadata.jobName || env.GITHUB_JOB
    const resolvedJobId = env.JOB_CHECK_RUN_ID || metadata.jobId
    const jobId = resolvedJobId && /^\d+$/.test(resolvedJobId) ? resolvedJobId : undefined
    const offset = env.ACTIONS_RUNNER_HOOK_JOB_STARTED ? 1 : 0
    const declaredIndex = metadata.steps.findIndex((step) => step.contextName === env.GITHUB_ACTION)
    const override = env.DD_GITHUB_STEP_INDEX
    const stepIndex =
      override && /^\d+$/.test(override) ? override : declaredIndex >= 0 ? String(declaredIndex + offset) : undefined
    const post = env.DD_CI_PHASE === 'post'
    const ciEnv = compact({
      GITHUB_SERVER_URL: server,
      GITHUB_REPOSITORY: repository,
      GITHUB_RUN_ID: runId,
      GITHUB_RUN_ATTEMPT: attempt,
      GITHUB_JOB: env.GITHUB_JOB,
      DD_GITHUB_JOB_NAME: jobName,
      DD_GITHUB_STEP_INDEX: post ? undefined : stepIndex,
    })
    const ref = env.GITHUB_HEAD_REF || env.GITHUB_REF || ''

    return {
      ciEnv,
      stepIndices: metadata.steps.length
        ? metadata.steps.map((_, i) => i + offset)
        : stepIndex === undefined
          ? []
          : [Number(stepIndex)],
      tags: compact({
        'ci.provider.name': 'github',
        // Preserve the existing custom-span intake contract; attempts are also in _dd.ci.env_vars.
        'ci.pipeline.id': runId,
        'ci.pipeline.name': env.GITHUB_WORKFLOW,
        'ci.pipeline.number': env.GITHUB_RUN_NUMBER,
        'ci.pipeline.url':
          repository && runId ? `${server}/${repository}/actions/runs/${runId}/attempts/${attempt}` : undefined,
        'ci.job.name': jobName,
        'ci.job.id': jobId || env.GITHUB_JOB,
        'ci.job.url':
          repository && runId && jobId
            ? `${server}/${repository}/actions/runs/${runId}/job/${jobId}`
            : repository && env.GITHUB_SHA
              ? `${server}/${repository}/commit/${env.GITHUB_SHA}/checks`
              : undefined,
        'ci.workspace_path': env.GITHUB_WORKSPACE,
        'git.repository_url': sanitizeRepositoryUrl(
          env.DD_GIT_REPOSITORY_URL || (repository ? `${server}/${repository}.git` : undefined)
        ),
        'git.commit.sha': env.DD_GIT_COMMIT_SHA || env.GITHUB_SHA,
        'git.branch': env.DD_GIT_BRANCH || (!ref.startsWith('refs/tags/') ? normalizeRef(ref) : undefined),
        'git.tag': env.DD_GIT_TAG || (ref.startsWith('refs/tags/') ? normalizeRef(ref) : undefined),
        'git.pull_request.base_branch': env.GITHUB_BASE_REF,
        'git.commit.head.sha': event?.pull_request?.head?.sha,
        'git.pull_request.base_branch_head_sha': event?.pull_request?.base?.sha,
        'pr.number': event?.pull_request?.number?.toString(),
        '_dd.ci.env_vars': JSON.stringify(
          compact({
            GITHUB_SERVER_URL: server,
            GITHUB_REPOSITORY: repository,
            GITHUB_RUN_ID: runId,
            GITHUB_RUN_ATTEMPT: attempt,
            DD_GITHUB_JOB_NAME: jobName,
          })
        ),
      }),
    }
  }
}
