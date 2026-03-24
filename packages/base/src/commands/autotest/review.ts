import {createWriteStream} from 'fs'
import {join} from 'path'

import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {detectDiffContext, getDiff} from './diff-context'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_USER_AGENT = 'datadog-ci-autotest'
const GITHUB_PR_URL_RE = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/

const parseGitHubPrUrl = (url: string): {repo: string; number: number} | undefined => {
  const match = url.match(GITHUB_PR_URL_RE)
  if (!match) {
    return undefined
  }

  return {repo: match[1], number: parseInt(match[2], 10)}
}

const PROD_DATA_COLLECTOR_PROMPT = `You are a production data collector. Your ONLY job is to capture live
production inputs using Datadog Live Debugger logpoints.

CRITICAL: You MUST use these specific MCP tools in this exact order:
  1. mcp__datadog-mcp__discover_datadog_logpoint
  2. mcp__datadog-mcp__create_datadog_logpoint
  3. sleep 60 (via Bash)
  4. mcp__datadog-mcp__search_datadog_logs
  5. mcp__datadog-mcp__delete_datadog_session

Do NOT use search_datadog_metrics, get_datadog_metric, or any other Datadog tools.
Do NOT skip the logpoint flow. Do NOT substitute with metrics or traces.
The ONLY way to get production inputs is via Live Debugger logpoints.

You will receive a PR diff. For each function that has meaningful logic changes in a
deployed service, place a logpoint to capture its live inputs.

## Detailed steps

### Step 1 — Find the function and resolve the APM service name

Search the codebase for the changed function. Then trace from the function's package to
the main.go that imports it and extract the service name from ddapp.NewApp(...), appName
constants, or DD_SERVICE env vars. The APM service name is often NOT the directory name.

### Step 2 — Call discover_datadog_logpoint

Arguments:
- datadog_apm_service_name: the resolved service name
- repository_url: MUST include .git suffix (e.g. https://github.com/DataDog/dd-go.git)

If discovery fails with the resolved name, try the directory name as fallback.

### Step 3 — Call create_datadog_logpoint

Arguments from the discover response, plus:
- file_path: Start with shortest package-relative path (e.g. processor/processor.go).
  If "no runtime_path found", try progressively longer prefixes automatically.
- method_name: the function name (for method probes) OR line_number for line probes.
- message_template: Use {param} syntax. Dot notation accesses FIELDS not methods.
  For interfaces/abstract types, capture the whole object {obj}.
  Skip context.Context, callbacks, and channels.
- Go/Ruby: conditions are NOT supported — never set one.
- environment: prefer staging when available.

### Step 4 — Wait 60 seconds

Run: Bash sleep 60

### Step 5 — Collect captured data

Call mcp__datadog-mcp__search_datadog_logs to fetch the captured logpoint data.
Use use_log_patterns: true for clustering.

Do NOT request extra_fields: ['debugger*'] — snapshots are enormous.

### Step 6 — Clean up

Call mcp__datadog-mcp__delete_datadog_session with the session_id from step 3.

### Step 7 — Return results

Return a structured summary:
- total captures
- representative sample inputs (3-5 diverse examples with actual field values)
- common input patterns (which params vary vs constant)
- distinct traffic classes with percentages

If the changed code is clearly not deployed (CLI tooling, build scripts, docs), return
"SKIP: code is not deployed" immediately.`

const SYSTEM_PROMPT = `You are an AI code validation agent running inside CI for a pull request.

Your job is to determine whether this PR introduces suspicious behavioral regressions by
executing the code on realistic, high-value scenarios. Do not do static code review. Do not
give style feedback. Only report issues that are grounded in code execution.

## Workflow

You MUST follow this two-phase workflow:

### Phase 1: Parallel startup (do BOTH immediately)

As your VERY FIRST action, do these two things in parallel:

A) **Spawn the "prod-data-collector" subagent** with the PR diff. This agent captures live
   production inputs from deployed services via Datadog Live Debugger. It takes 1-2 minutes,
   so you MUST start it immediately. Pass the full diff as the prompt.

B) **Analyze the PR** while the subagent collects data:
   - Read the diff and nearby code
   - Determine what behavior the PR changes, what should stay the same, and what's riskiest
   - Focus on: retries, duplicate handling, malformed inputs, fallback paths, error handling,
     state transitions, classification/transformation changes, edge-case parsing
   - Inspect nearby existing tests
   - Pick 1-2 target entrypoints to validate

### Phase 2: Build and run validation (after subagent returns)

Once the prod-data-collector subagent returns with real production inputs:

1. **Build test scenarios** using the captured production inputs as fixtures. Supplement with
   edge cases (missing fields, malformed payloads, boundary values, duplicates, empty
   collections, whitespace).

2. **Create temporary validation code** — prefer one table-driven test file. Keep assertions
   focused on return values, errors, and key output fields. Do not overfit to formatting.

3. **Execute on HEAD and BASE** — run the same scenarios against both, compare results.
   Distinguish intended changes from suspicious regressions.

4. **Produce the final report** as validation_report.md:

# AI Validation Report

## PR behavior summary
2 to 5 bullet points.

## Production data captured
What the live debugger captured — input patterns, traffic classes, volume.

## Scenarios tested
Bullet list of scenarios (noting which used real prod inputs vs synthetic).

## Suspicious findings
For each: title, why suspicious, input summary, BASE vs HEAD behavior.
If none, say so clearly.

## Expected changes observed
Intentional behavior changes that were not flagged.

## Validation gaps
What you could not validate.

### Phase 3: Post results

After writing validation_report.md, you MUST post the report as a PR comment using
the create_pr_comment tool. Use the full markdown report as the comment body.
This is a required step — do not skip it.

## Important constraints
- Prefer execution over speculation.
- Only flag issues grounded in actual code execution.
- Suppress clearly intended behavior differences.
- Keep generated files temporary and isolated.
- Reuse existing test helpers and fixtures.
- Keep scope tight: 1-2 high-risk areas, 5-10 scenarios.
- Prefer package/unit-level execution over fragile E2E.
- If you cannot execute a scenario, say so — do not bluff.`

const MODEL = 'claude-opus-4-6'

const MAX_DIFF_LENGTH = 512 * 1024 // 512 KB — keep within reasonable prompt size

export class AutotestCommand extends BaseCommand {
  public static paths = [['autotest']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Validate the current pull request by executing code against realistic scenarios.',
    details: `
      This command detects the current pull request or merge request context,
      computes the diff, and launches an AI agent that validates the changes
      by actually executing code — not just reviewing it statically.

      The agent compares behavior between the base and head branches using
      temporary tests and validation scripts, and reports only suspicious
      regressions grounded in actual code execution.

      Optionally uses Datadog Live Debugger to capture production inputs
      as realistic test fixtures.

      Requires ANTHROPIC_API_KEY, DD_API_KEY, and DD_APPLICATION_KEY.

      Supported CI providers:
        - GitHub Actions (pull_request / pull_request_target triggers)
        - GitLab CI (merge request pipelines)
    `,
    examples: [
      ['Validate the current PR (CI)', 'datadog-ci autotest'],
      ['Validate a specific PR (local)', 'datadog-ci autotest --pr https://github.com/DataDog/dd-go/pull/217807'],
    ],
  })

  private pr = Option.String('--pr', {
    description: 'GitHub PR URL to validate. Fetches the diff via the GitHub API.',
    required: false,
  })

  public async execute(): Promise<number> {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.context.stderr.write(
        'Error: ANTHROPIC_API_KEY environment variable is not set.\n' +
          'Get an API key from https://console.anthropic.com/ and export it.\n'
      )

      return 1
    }

    if (!process.env.DD_API_KEY || !process.env.DD_APPLICATION_KEY) {
      this.context.stderr.write(
        'Error: DD_API_KEY and DD_APPLICATION_KEY environment variables are required for Datadog MCP tools.\n'
      )

      return 1
    }

    let diff: string
    let prInfo: {repo: string; number: number} | undefined

    if (this.pr) {
      // Fetch diff from GitHub via `gh pr diff`.
      this.context.stderr.write(`Fetching diff from ${this.pr}…\n`)
      prInfo = parseGitHubPrUrl(this.pr)
      try {
        diff = await this.fetchPrDiff(this.pr)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.context.stderr.write(`Error: Failed to fetch PR diff: ${message}\n`)

        return 1
      }
    } else {
      const diffContext = detectDiffContext()
      if (!diffContext) {
        this.context.stderr.write(
          'Error: Could not detect a pull request or merge request context.\n' +
            'Supported CI providers:\n' +
            '  - GitHub Actions: requires a pull_request or pull_request_target trigger\n' +
            '  - GitLab CI: requires a merge request pipeline (merge_request_event)\n' +
            '\nFor local testing, use --pr <github-pr-url>\n'
        )

        return 1
      }

      prInfo = diffContext.pr
      this.context.stderr.write(`Detected ${diffContext.provider} — computing diff…\n`)
      try {
        diff = await getDiff(diffContext)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.context.stderr.write(`Error: Failed to compute diff (${diffContext.provider}): ${message}\n`)

        return 1
      }
    }

    if (!diff) {
      this.context.stderr.write('No changes detected.\n')

      return 0
    }

    if (diff.length > MAX_DIFF_LENGTH) {
      this.context.stderr.write(
        `Warning: Diff is ${(diff.length / 1024).toFixed(0)} KB — truncating to ${MAX_DIFF_LENGTH / 1024} KB to stay within prompt limits.\n`
      )
      diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n\n[… diff truncated …]\n'
    }

    this.context.stderr.write('Starting AI validation…\n')

    try {
      return await this.runReview(diff, prInfo)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: AI review failed: ${message}\n`)

      return 1
    }
  }

  private async fetchPrDiff(prUrl: string): Promise<string> {
    const pr = parseGitHubPrUrl(prUrl)
    if (!pr) {
      throw new Error(`Invalid GitHub PR URL: ${prUrl}`)
    }
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

    const response = await fetch(`${GITHUB_API_BASE}/repos/${pr.repo}/pulls/${pr.number}`, {
      headers: {
        Accept: 'application/vnd.github.v3.diff',
        'User-Agent': GITHUB_USER_AGENT,
        ...(token ? {Authorization: `token ${token}`} : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${await response.text()}`)
    }

    return response.text()
  }

  private async runReview(diff: string, prInfo?: {repo: string; number: number}): Promise<number> {
    const {query, tool, createSdkMcpServer} = await import('@anthropic-ai/claude-agent-sdk')
    const {z} = await import('zod')

    const userPrompt = `Here is the pull request diff to validate:\n\n\`\`\`diff\n${diff}\n\`\`\``

    // GitHub PR tools — uses the REST API directly (no gh CLI dependency).
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

    const githubApiFetch = async (path: string, method: string, body?: object) => {
      const response = await fetch(`${GITHUB_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': GITHUB_USER_AGENT,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) {
        return {
          content: [{type: 'text' as const, text: `GitHub API error ${response.status}: ${await response.text()}`}],
          isError: true,
        }
      }

      return {content: [{type: 'text' as const, text: JSON.stringify(await response.json())}]}
    }

    const githubTools = prInfo && githubToken
      ? (() => {
          const {repo, number: prNumber} = prInfo

          const createPrComment = tool(
            'create_pr_comment',
            'Post a new comment on the pull request. Use this to share your validation report.',
            {body: z.string().describe('Markdown body of the comment')},
            async (args: {body: string}) =>
              githubApiFetch(`/repos/${repo}/issues/${prNumber}/comments`, 'POST', {body: args.body})
          )

          const editPrComment = tool(
            'edit_pr_comment',
            'Edit an existing comment on the pull request by comment ID.',
            {
              comment_id: z.string().describe('The comment ID to edit'),
              body: z.string().describe('New markdown body for the comment'),
            },
            async (args: {comment_id: string; body: string}) =>
              githubApiFetch(`/repos/${repo}/issues/comments/${args.comment_id}`, 'PATCH', {body: args.body})
          )

          return createSdkMcpServer({
            name: 'github-pr',
            version: '1.0.0',
            tools: [createPrComment, editPrComment],
          })
        })()
      : undefined

    // Raw log file for full agent trace.
    const logDir = process.env.AUTOTEST_REPO_DIR || process.cwd()
    const logPath = join(logDir, '.autotest-agent.log')
    const logStream = createWriteStream(logPath, {flags: 'w'})
    const log = (entry: string) => logStream.write(`[${new Date().toISOString()}] ${entry}\n`)
    log(`Starting autotest validation`)

    const ora = (await import('ora')).default
    const spinner = ora({text: 'Connecting…', stream: this.context.stderr}).start()

    const mcpServers: Record<string, unknown> = {
      'datadog-mcp': {
        type: 'http',
        url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=core,live-debugger',
        headers: {
          'DD-API-KEY': process.env.DD_API_KEY ?? '',
          'DD-APPLICATION-KEY': process.env.DD_APPLICATION_KEY ?? '',
        },
      },
    }
    if (githubTools) {
      mcpServers['github-pr'] = githubTools
    }

    try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        mcpServers,
        cwd: logDir,
        settingSources: ['project'],
        allowedTools: ['*'],
        permissionMode: 'bypassPermissions',
        systemPrompt: SYSTEM_PROMPT,
        model: MODEL,
        agents: {
          'prod-data-collector': {
            description:
              'Captures live production inputs for changed functions using Datadog Live Debugger. Takes 1-2 minutes. Start immediately and in the background.',
            prompt: PROD_DATA_COLLECTOR_PROMPT,
            tools: [
              'Read',
              'Grep',
              'Glob',
              'Bash',
              'mcp__datadog-mcp__discover_datadog_logpoint',
              'mcp__datadog-mcp__create_datadog_logpoint',
              'mcp__datadog-mcp__search_datadog_logs',
              'mcp__datadog-mcp__analyze_datadog_logs',
              'mcp__datadog-mcp__delete_datadog_session',
            ],
          },
        },
      },
    })) {
      const msg = message as any

      // Log every message to the raw log file.
      log(`[${msg.type}${msg.subtype ? ':' + msg.subtype : ''}] ${JSON.stringify(msg).slice(0, 2000)}`)

      if (isSystemInitMessage(message)) {
        const servers = msg.mcp_servers ?? []
        for (const server of servers) {
          const status = server.status ?? 'unknown'
          const name = server.name ?? 'unnamed'
          spinner.text = status === 'connected' ? `MCP "${name}" connected` : `MCP "${name}": ${status}`
        }
      }

      if (isAssistantMessage(message)) {
        const content = msg.message?.content ?? msg.content ?? []
        for (const block of content) {
          if (block.type === 'text') {
            const firstLine = (block.text ?? '').split('\n')[0].slice(0, 80)
            if (firstLine) {
              spinner.text = firstLine
            }
          }
          if (block.type === 'tool_use') {
            spinner.text = (block as any).name ?? ''
          }
        }
      }

      if (isResultMessage(message)) {
        spinner.stop()
        this.context.stdout.write(msg.result + '\n')
      }
    }

    } finally {
      spinner.stop()
      logStream.end()
    }
    this.context.stderr.write(`Agent log saved to ${logPath}\n`)

    return 0
  }
}

interface AssistantMessage {
  type: 'assistant'
  content?: Array<{type: string; text?: string; name?: string}>
}

interface ResultMessage {
  type: 'result'
  result: string
}

const isSystemInitMessage = (msg: unknown): boolean =>
  typeof msg === 'object' && msg !== null && (msg as any).type === 'system' && (msg as any).subtype === 'init'

const isAssistantMessage = (msg: unknown): msg is AssistantMessage =>
  typeof msg === 'object' && msg !== null && (msg as any).type === 'assistant'

const isResultMessage = (msg: unknown): msg is ResultMessage =>
  typeof msg === 'object' && msg !== null && (msg as any).type === 'result'
