import {createWriteStream} from 'fs'
import {join} from 'path'

import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {getMetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import {detectDiffContext, type PrInfo} from './diff-context'

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

export interface AgentFinding {
  title: string
  file?: string
  line?: number
  explanation: string
}

export interface AgentReport {
  result: 'PASS' | 'FAIL'
  explanation: string
  findings: AgentFinding[]
  stats: {scenarios: number; prod_inputs: number}
}

export const parseAgentReport = (text: string): AgentReport | undefined => {
  // Find the last ```json ... ``` block in the text
  const matches = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)]
  if (matches.length === 0) {
    return undefined
  }

  const lastMatch = matches[matches.length - 1]
  try {
    const parsed = JSON.parse(lastMatch[1])
    if (!parsed.result || !parsed.stats) {
      return undefined
    }

    return {
      result: parsed.result === 'FAIL' ? 'FAIL' : 'PASS',
      explanation: parsed.explanation ?? '',
      findings: (parsed.findings ?? []).map((f: any) => ({
        title: f.title ?? '',
        file: f.file,
        line: f.line,
        explanation: f.explanation ?? '',
      })),
      stats: {
        scenarios: parsed.stats.scenarios ?? 0,
        prod_inputs: parsed.stats.prod_inputs ?? 0,
      },
    }
  } catch {
    return undefined
  }
}

export const getCiJobUrl = (): string | undefined => {
  // GitLab CI
  if (process.env.CI_JOB_URL) {
    return process.env.CI_JOB_URL
  }

  // GitHub Actions
  const serverUrl = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (serverUrl && repo && runId) {
    return `${serverUrl}/${repo}/actions/runs/${runId}`
  }

  return undefined
}

const COMMENT_MARKER = '<!-- datadog-ci-autotest -->'

export const formatComment = (
  report: AgentReport,
  finding: AgentFinding | undefined,
  ciJobUrl: string | undefined
): string => {
  const statsItems = [`${report.stats.scenarios} scenarios`, `${report.stats.prod_inputs} prod inputs`]
  const statsLine = ciJobUrl
    ? `> 📊 ${statsItems.join(' · ')} · [View full log](${ciJobUrl})`
    : `> 📊 ${statsItems.join(' · ')}`

  const footer = `${statsLine}\n\nWas this helpful? 👍 👎`

  if (!finding) {
    if (report.result === 'FAIL') {
      // FAIL with no specific finding — use top-level explanation
      return `${COMMENT_MARKER}\n## 🔴 Autotest: FAIL\n\n${report.explanation}\n\n${footer}`
    }
    // PASS comment
    return `${COMMENT_MARKER}\n## ✅ Autotest: PASS\n\n${report.explanation}\n\n${footer}`
  }

  const isInline = !!(finding.file && finding.line)
  if (isInline) {
    // Inline review comment — no title needed, the line provides context
    return `${COMMENT_MARKER}\n## 🔴 Autotest: FAIL\n\n${finding.explanation}\n\n${footer}`
  }

  // Issue comment for finding without a specific line — include title
  return `${COMMENT_MARKER}\n## 🔴 Autotest: FAIL\n\n**${finding.title}**\n\n${finding.explanation}\n\n${footer}`
}

const PROD_DATA_COLLECTOR_PROMPT = `You are a production data collector. Your ONLY job is to capture live
production inputs using Datadog Live Debugger logpoints.

CRITICAL: You MUST use these steps in order:
  1. Resolve the APM service name from the codebase
  2. mcp__datadog-mcp__discover_datadog_logpoint  (get the deployed SHA)
  3. mcp__datadog-mcp__create_datadog_logpoint  (use the discovered SHA)
  4. Bash: sleep 120
  5. mcp__datadog-mcp__search_datadog_logs
  6. mcp__datadog-mcp__delete_datadog_session
Do NOT fall back to search_datadog_spans, search_datadog_logs, search_datadog_metrics,
or any other Datadog tool to substitute for real logpoint captures.
If DI is not available, return SKIP immediately — do NOT produce a result from other sources.
The ONLY valid production data comes from Live Debugger logpoints.

You will receive a PR diff. Place logpoints on the SPECIFIC FUNCTIONS that are CHANGED
in the diff — not on unrelated functions in the same service. The goal is to capture
the actual production inputs flowing into the changed code paths so we can verify the
change handles real-world data correctly.

You MUST place logpoints on ALL relevant changed functions, not just one. Create
multiple logpoints in the same session if the diff touches multiple functions.

TARGETING RULES:
- If the diff modifies functions Foo() and Bar(), place logpoints on BOTH
- If the diff adds a new case to a switch statement, place the logpoint on the function
  containing that switch to see ALL values flowing through it (including ones NOT handled)
- If the diff changes serialization/deserialization, place the logpoint where the data
  enters the function to capture the raw input shape
- If the diff changes a caller AND a callee, instrument both to see data flow
- Do NOT instrument unrelated functions, feature flag checks, or config loading

## Detailed steps

### Step 1 — Resolve the APM service name and repository URL

Search the codebase for the changed function. Then trace from the function's package to
the main.go that imports it and extract the service name from ddapp.NewApp(...), appName
constants, or DD_SERVICE env vars. The APM service name is often NOT the directory name.

Determine the repository URL from the git remote:
  Bash: git remote get-url origin

### Step 2 — Discover the deployed SHA via Live Debugger

Call mcp__datadog-mcp__discover_datadog_logpoint with:
- service_name: from step 1
- environment: "prod"

This returns the SHA currently running in production. Use THAT SHA for create_logpoint.
Do NOT use git rev-parse HEAD — that's the PR branch tip which has NOT been deployed.

If discover fails or returns no active instances:
Return "SKIP: DI not available for <service> in prod (<error>)" immediately.
Do NOT attempt any fallback. Do NOT search spans or logs as a substitute.

### Step 3 — Call create_datadog_logpoint

Arguments:
- service_name: the resolved APM service name
- repository_url: from git remote (strip .git suffix if present)
- git_sha: the deployed SHA from discover (step 2)
- environment: "prod"
- language: infer from file extension (go, python, java, etc.)
- file_path: Start with shortest package-relative path (e.g. processor/processor.go).
  If "no runtime_path found" error, try progressively longer prefixes automatically.
- method_name: the function name (for method probes) OR line_number for line probes.
- message_template: Use {param} syntax. Dot notation accesses FIELDS not methods.
  For interfaces/abstract types, capture the whole object {obj}.
  Skip context.Context, callbacks, and channels.
- Go/Ruby: conditions are NOT supported — never set one.

If create fails with ANY error (no active instances, SHA mismatch, not found):
Return "SKIP: DI not available for <service> in prod (<error>)" immediately.
Do NOT attempt any fallback. Do NOT search spans or logs as a substitute.

### Step 4 — Wait 2 minutes

Run: Bash sleep 120

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
   production inputs from deployed services via Datadog Live Debugger. It takes ~2 minutes,
   so you MUST start it immediately. Pass the full diff as the prompt.

B) **Analyze the PR** while the subagent collects data:
   - Read the diff and nearby code
   - Determine what behavior the PR changes, what should stay the same, and what's riskiest
   - Focus on: retries, duplicate handling, malformed inputs, fallback paths, error handling,
     state transitions, classification/transformation changes, edge-case parsing
   - Inspect nearby existing tests
   - Pick 1-2 target entrypoints to validate
   - CRITICAL: Identify inputs the code does NOT handle — switch/case statements without
     default, type assertions that could fail, field lookups that assume a specific shape,
     hardcoded allowlists/enums that may not cover all production values

### Phase 2: Build and run validation (after subagent returns)

Once the prod-data-collector subagent returns with real production inputs:

1. **Build ADVERSARIAL test scenarios.** Do NOT just run existing tests. The goal is to find
   bugs that existing tests miss. Specifically:
   - Use prod inputs to discover the REAL diversity of values (field types, enum values,
     data shapes) that the code receives in production
   - Compare that diversity against what the code handles — look for gaps
   - Generate test cases for values that EXIST in production but are NOT handled by the code
   - Example: if the code has a switch on field type and handles "A" and "B", but prod data
     shows "C" also appears — test with "C"
   - Example: if the code assumes a field is an object, but prod data shows it's sometimes
     an array — test with an array
   - Example: if the code serializes a struct, verify the JSON output matches what the
     downstream consumer expects (nil vs [], 0 vs omitted, etc.)

2. **Create temporary validation code** — prefer one table-driven test file.
   CRITICAL: Test BOTH input handling AND output correctness:
   - Does the function handle ALL input values that appear in production?
   - Does the function PRODUCE correct output? (serialize correctly, return expected fields,
     format data properly for downstream consumers)
   - Does the output work when consumed by the next system in the pipeline?
   - For serialization: verify JSON/protobuf wire format (nil vs empty array, int vs float,
     missing vs zero-value fields)
   - For routing/filtering: verify ALL production input values are routed correctly, not
     just the ones in the test fixtures
   - For switch/case/if-else chains: test with values NOT in the explicit cases
   Do not just test that the code "doesn't crash" — test that it handles the FULL diversity
   of production inputs correctly.

3. **Execute the validation scenarios** against the current code. Flag crashes, errors,
   and unexpected outputs (including silently wrong outputs like nil where [] is expected,
   0 where a value should be present, missing fields in serialized output, or silently
   dropped/ignored inputs).

4. **Output the report** as your final message. The system will parse it and post PR comments automatically. Do NOT use "gh pr comment", curl, or any other tool to post — just output the report text.

Your LAST message MUST end with a fenced JSON block in this exact schema:

\`\`\`json
{
  "result": "PASS or FAIL",
  "explanation": "What was validated and why it's correct (PASS) or a brief summary of what's wrong (FAIL)",
  "findings": [
    {
      "title": "Short title of the issue",
      "file": "path/to/file.go",
      "line": 256,
      "explanation": "Full explanation of the issue. Can be as long as needed to properly explain the problem, its impact, and what production data confirms it."
    }
  ],
  "stats": {
    "scenarios": 6,
    "prod_inputs": 34
  }
}
\`\`\`

Rules for the JSON output:
- Use "PASS" when there are zero suspicious findings. Use "FAIL" when there are any.
- \`explanation\` at the top level: for PASS, explain what was validated and why it looks correct (2-3 sentences). For FAIL, give a brief summary.
- Each finding in \`findings\`: \`title\` is a short label. \`file\` and \`line\` are optional — include them when the issue maps to a specific line in the diff. \`explanation\` is the full description, as detailed as needed.
- \`stats.scenarios\`: number of test scenarios executed. \`stats.prod_inputs\`: number of production inputs captured via Live Debugger (0 if skipped).
- The JSON block must be valid JSON. Do not include comments or trailing commas.

Before the JSON block, you may include your full analysis, execution logs, and reasoning as regular text. This text will be saved to validation_report.md as a CI artifact. Only the JSON block is used for PR comments.

## Important constraints
- Prefer execution over speculation.
- Only flag issues grounded in actual code execution.
- Suppress clearly intended behavior differences.
- Keep generated files temporary and isolated.
- Reuse existing test helpers and fixtures.
- Keep scope tight: 1-2 high-risk areas, 5-10 scenarios.
- Prefer package/unit-level execution over fragile E2E.
- If you cannot execute a scenario, say so — do not bluff.
- For Go projects, always use \`go test -tags dynamic\` — never use Bazel, it is too slow for CI validation.`

const MODEL = 'claude-sonnet-4-6'

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

  private baseRef = Option.String('--base-ref', {
    description: 'Compute diff from git using this base ref (e.g. origin/main). Skips PR comment posting.',
    required: false,
  })

  private dryRun = Option.Boolean('--dry-run', false, {
    description: 'Skip posting the PR comment. The report is still written to stdout and validation_report.md.',
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

    // Resolve diff — either from a pre-computed file, git (--base-ref), GitHub API (--pr), or CI auto-detection.
    let prInfo: PrInfo | undefined
    let diff: string

    if (process.env.AUTOTEST_DIFF_FILE) {
      const {readFileSync} = await import('fs')
      diff = readFileSync(process.env.AUTOTEST_DIFF_FILE, 'utf8')
      this.context.stderr.write(
        `Reading diff from ${process.env.AUTOTEST_DIFF_FILE} (${(diff.length / 1024).toFixed(0)} KB)\n`
      )
    } else if (this.baseRef) {
      this.context.stderr.write(`Computing diff from git: HEAD vs ${this.baseRef}…\n`)
      const {execSync} = await import('child_process')
      const repoDir = process.env.AUTOTEST_REPO_DIR || process.cwd()
      try {
        diff = execSync(`git diff ${this.baseRef}...HEAD`, {
          cwd: repoDir,
          maxBuffer: MAX_DIFF_LENGTH * 2,
        }).toString()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.context.stderr.write(`Error: Failed to compute git diff: ${message}\n`)

        return 1
      }
    } else {
      if (this.pr) {
        const parsed = parseGitHubPrUrl(this.pr)
        if (!parsed) {
          this.context.stderr.write(`Error: Invalid GitHub PR URL: ${this.pr}\n`)

          return 1
        }
        prInfo = {...parsed, provider: 'github'}
      } else {
        const diffContext = detectDiffContext()
        if (!diffContext?.pr) {
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
        this.context.stderr.write(`Detected ${diffContext.providerName} (PR #${prInfo.number})…\n`)
      }

      this.context.stderr.write(`Fetching diff for ${prInfo.repo}#${prInfo.number}…\n`)
      try {
        diff = await this.fetchDiff(prInfo)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.context.stderr.write(`Error: Failed to fetch diff: ${message}\n`)

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

    let exitCode: number
    try {
      const result = await this.runReview(diff, this.dryRun ? undefined : prInfo, this.dryRun)
      exitCode = result.exitCode
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: AI review failed: ${message}\n`)
      exitCode = 1
    }

    // Force exit — the SDK may leave open connections (MCP, HTTP) that keep the event loop alive.
    process.exit(exitCode)
  }

  private async fetchDiff(pr: PrInfo): Promise<string> {
    if (pr.provider === 'gitlab') {
      return this.fetchGitLabDiff(pr)
    }

    return this.fetchGitHubDiff(pr)
  }

  private async fetchGitHubDiff(pr: PrInfo): Promise<string> {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    const pathFilter = process.env.AUTOTEST_PATH_FILTER

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

    const fullDiff = await response.text()

    if (!pathFilter) {
      return fullDiff
    }

    // Filter diff to only include hunks for files matching the path prefix
    const sections = fullDiff.split(/(?=^diff --git )/m)
    const filtered = sections.filter((s) => {
      const match = s.match(/^diff --git a\/(.+) b\//)
      return match && match[1].startsWith(pathFilter)
    })
    return filtered.join('')
  }

  private async fetchGitLabDiff(pr: PrInfo): Promise<string> {
    const gitlabUrl = process.env.CI_SERVER_URL || 'https://gitlab.com'
    const token = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN
    const projectId = encodeURIComponent(pr.repo)

    const response = await fetch(
      `${gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${pr.number}/diffs`,
      {
        headers: {
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
      }
    )

    if (!response.ok) {
      throw new Error(`GitLab API error ${response.status}: ${await response.text()}`)
    }

    // GitLab returns an array of diff objects — convert to unified diff format.
    const diffs = (await response.json()) as Array<{
      old_path: string
      new_path: string
      diff: string
    }>

    return diffs
      .map((d) => {
        const header =
          d.old_path === d.new_path
            ? `diff --git a/${d.old_path} b/${d.new_path}`
            : `diff --git a/${d.old_path} b/${d.new_path}\nrename from ${d.old_path}\nrename to ${d.new_path}`

        return `${header}\n${d.diff}`
      })
      .join('\n')
  }

  private async runReview(diff: string, prInfo?: PrInfo, dryRun = false): Promise<{exitCode: number; resultText: string}> {
    const {query} = await import('@anthropic-ai/claude-agent-sdk')

    let resultText = ''
    let reportText = ''  // The ## 🔬 Autotest: report — captured from any message
    let prCommentPosted = false
    const userPrompt = `Here is the pull request diff to validate:\n\n\`\`\`diff\n${diff}\n\`\`\``

    // Raw log file for full agent trace.
    const repoDir = process.env.AUTOTEST_REPO_DIR || process.cwd()
    // Log files go to HOME (writable by nobody in CI), agent cwd goes to repoDir (the git checkout)
    const logDir = process.env.HOME || repoDir
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

    // Abort after 25 minutes so the process exits cleanly before CI job timeout
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => {
      this.context.stderr.write('Autotest timeout reached (25min), aborting query...\n')
      abortController.abort()
    }, 25 * 60 * 1000)

    try {
    // Capture CLI subprocess stderr for debugging exit-code-1 failures
    const {spawn} = await import('child_process')
    const spawnClaudeCodeProcess = (cfg: {command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal}) => {
      const proc = spawn(cfg.command, cfg.args, {
        cwd: cfg.cwd,
        env: cfg.env,
        signal: cfg.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      proc.stderr?.on('data', (data: Buffer) => {
        this.context.stderr.write(`[claude-code] ${data}`)
      })
      return proc
    }

    for await (const message of query({
      prompt: userPrompt,
      options: {
        mcpServers,
        cwd: repoDir,
        settingSources: process.env.AUTOTEST_SETTING_SOURCES
          ? process.env.AUTOTEST_SETTING_SOURCES.split(',')
          : ['project'],
        allowedTools: ['*'],
        permissionMode: 'bypassPermissions',
        spawnClaudeCodeProcess,
        abortController,
        systemPrompt: SYSTEM_PROMPT + (dryRun
          ? '\n\n## DRY RUN MODE\nDo NOT post any PR comments. Do NOT use gh, curl, or any other method to post comments. Only write the report to stdout and validation_report.md.'
          : ''),
        model: MODEL,
        maxTurns: 25,
        agents: {
          'prod-data-collector': {
            description:
              'Captures live production inputs for changed functions using Datadog Live Debugger. Takes ~2 minutes. Start immediately and in the background.',
            prompt: PROD_DATA_COLLECTOR_PROMPT,
            model: 'sonnet',
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
      const isSubagent = !!msg.parent_tool_use_id
      const prefix = isSubagent ? '[subagent] ' : ''
      const typeTag = `${msg.type}${msg.subtype ? ':' + msg.subtype : ''}`

      // Log full message — no truncation.
      log(`${prefix}[${typeTag}] ${JSON.stringify(msg)}`)

      // Log task_progress events (subagent tool activity).
      if (msg.subtype === 'task_progress') {
        const toolName = msg.last_tool_name ?? ''
        const desc = msg.description ?? ''
        spinner.text = `${desc}${toolName ? ` → ${toolName}` : ''}`
      }

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
            const text = block.text ?? ''
            const firstLine = text.split('\n')[0].slice(0, 80)
            if (firstLine) {
              spinner.text = `${prefix}${firstLine}`
            }
            // Capture the report only if it parses as a valid AgentReport
            if (!isSubagent && parseAgentReport(text)) {
              reportText = text
            }
          }
          if (block.type === 'tool_use') {
            spinner.text = `${prefix}${(block as any).name ?? ''}`
          }
        }
      }

      if (isResultMessage(message)) {
        const text = msg.result ?? ''
        if (!isSubagent) {
          spinner.stop()
          this.context.stdout.write(text + '\n')

          // Post PR comment when we have the report.
          // Must happen here because the SDK may call process.exit() after the stream ends.
          resultText += text + '\n'
          if (parseAgentReport(text)) {
            reportText = text
          }
          // Prefer resultText (the actual final output) over reportText from assistant messages
          const commentBody = resultText.trim() || reportText
          if (prInfo && !dryRun && !prCommentPosted && commentBody.length > 0) {
            prCommentPosted = true
            try {
              await this.postResults(commentBody, prInfo)
            } catch (e) {
              this.context.stderr.write(`PR comment error: ${e}\n`)
            }
            try {
              await this.reportTelemetry(resultText, prInfo)
            } catch {
              // best effort
            }
          }
        }
        resultText += isSubagent ? text + '\n' : ''
      }
    }

    } finally {
      clearTimeout(timeoutHandle)
      spinner.stop()
      logStream.end()
    }

    // Write full agent output to validation_report.md for CI artifact
    try {
      const {writeFileSync} = await import('fs')
      const reportPath = join(repoDir, 'validation_report.md')
      writeFileSync(reportPath, resultText)
      this.context.stderr.write(`Full report saved to ${reportPath}\n`)
    } catch (err) {
      this.context.stderr.write(`Warning: Failed to write validation_report.md: ${err}\n`)
    }

    this.context.stderr.write(`Agent log saved to ${logPath}\n`)

    const report = parseAgentReport(resultText)
    const isFail = report ? report.result === 'FAIL' : /FAIL/i.test(resultText)

    return {exitCode: isFail ? 1 : 0, resultText}
  }

  private async postResults(resultText: string, prInfo: PrInfo) {
    const report = parseAgentReport(resultText)
    const ciJobUrl = getCiJobUrl()

    if (!report) {
      // Fallback: post raw text as a single issue comment (current behavior)
      await this.postIssueComment(`${COMMENT_MARKER}\n${resultText.trim()}`, prInfo)
      return
    }

    if (report.result === 'PASS' || report.findings.length === 0) {
      const body = formatComment(report, undefined, ciJobUrl)
      await this.postIssueComment(body, prInfo)
      return
    }

    // FAIL — post each finding as its own comment
    for (const finding of report.findings) {
      const body = formatComment(report, finding, ciJobUrl)

      if (finding.file && finding.line && prInfo.provider === 'github') {
        await this.postInlineReviewComment(body, finding.file, finding.line, prInfo)
      } else {
        await this.postIssueComment(body, prInfo)
      }
    }
  }

  private async postIssueComment(body: string, prInfo: PrInfo) {
    try {
      if (prInfo.provider === 'github') {
        const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
        if (!token) {
          this.context.stderr.write('No GITHUB_TOKEN, skipping PR comment.\n')
          return
        }

        const headers = {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': GITHUB_USER_AGENT,
        }

        const resp = await fetch(
          `${GITHUB_API_BASE}/repos/${prInfo.repo}/issues/${prInfo.number}/comments`,
          {method: 'POST', headers, body: JSON.stringify({body})}
        )
        if (resp.ok) {
          const json = (await resp.json()) as {html_url: string}
          this.context.stderr.write(`PR comment created: ${json.html_url}\n`)
        } else {
          this.context.stderr.write(`PR comment failed: ${resp.status} ${(await resp.text()).slice(0, 200)}\n`)
        }
      } else if (prInfo.provider === 'gitlab') {
        const token = process.env.CI_JOB_TOKEN || process.env.GITLAB_TOKEN
        if (!token) {
          return
        }
        const gitlabUrl = process.env.CI_SERVER_URL || 'https://gitlab.com'
        const projectId = encodeURIComponent(prInfo.repo)

        await fetch(
          `${gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${prInfo.number}/notes`,
          {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({body}),
          }
        )
      }
    } catch (err) {
      this.context.stderr.write(`PR comment error: ${err}\n`)
    }
  }

  private async postInlineReviewComment(body: string, file: string, line: number, prInfo: PrInfo) {
    try {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      if (!token) {
        await this.postIssueComment(body, prInfo)
        return
      }

      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': GITHUB_USER_AGENT,
      }

      // Get the latest commit SHA on the PR (required for the review API)
      const prResp = await fetch(`${GITHUB_API_BASE}/repos/${prInfo.repo}/pulls/${prInfo.number}`, {headers})
      if (!prResp.ok) {
        this.context.stderr.write(`Failed to fetch PR details: ${prResp.status}\n`)
        await this.postIssueComment(body, prInfo)
        return
      }
      const prData = (await prResp.json()) as {head: {sha: string}}
      const commitId = prData.head.sha

      const resp = await fetch(`${GITHUB_API_BASE}/repos/${prInfo.repo}/pulls/${prInfo.number}/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          commit_id: commitId,
          event: 'COMMENT',
          comments: [
            {
              path: file,
              line,
              side: 'RIGHT',
              body,
            },
          ],
        }),
      })

      if (resp.ok) {
        this.context.stderr.write(`Inline review comment posted on ${file}:${line}\n`)
      } else {
        const errText = (await resp.text()).slice(0, 200)
        this.context.stderr.write(`Inline review failed (${resp.status}: ${errText}), falling back to issue comment\n`)
        await this.postIssueComment(body, prInfo)
      }
    } catch (err) {
      this.context.stderr.write(`Inline review error: ${err}, falling back to issue comment\n`)
      await this.postIssueComment(body, prInfo)
    }
  }

  private async reportTelemetry(resultText: string, prInfo?: PrInfo) {
    const apiKey = process.env.DD_API_KEY
    if (!apiKey) {
      return
    }

    try {
      const report = parseAgentReport(resultText)

      const isFail = report ? report.result === 'FAIL' : /## 🔬 Autotest: FAIL/i.test(resultText)
      const scenarios = report?.stats.scenarios ?? 0
      const prodInputs = report?.stats.prod_inputs ?? 0
      const findingsCount = report?.findings.length ?? 0
      const hasExecutionLog = /Execution log/.test(resultText) && /\$\s+\w/.test(resultText)
      const method = hasExecutionLog ? 'execution' : 'static_analysis'

      const tags = [
        `result:${isFail ? 'fail' : 'pass'}`,
        `method:${method}`,
        `provider:${prInfo?.provider ?? 'unknown'}`,
        ...(prInfo ? [`repo:${prInfo.repo}`] : []),
        ...(prInfo ? [`pr:${prInfo.number}`] : []),
      ]

      const {logger, flush} = getMetricsLogger({
        apiKey,
        datadogSite: process.env.DD_SITE,
        prefix: 'datadog.ci.autotest.',
        defaultTags: tags,
      })

      logger.increment('run', 1)
      if (isFail) {
        logger.increment('regression_found', 1)
      }
      logger.gauge('scenarios_executed', scenarios)
      logger.gauge('prod_inputs_captured', prodInputs)
      logger.gauge('suspicious_findings', findingsCount)

      await flush()
    } catch {
      // Telemetry is best-effort — don't fail the command.
    }
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
