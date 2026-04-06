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

const PROD_DATA_COLLECTOR_PROMPT = `You are a production data collector. Your ONLY job is to capture live
production inputs using Datadog Live Debugger logpoints.

CRITICAL: You MUST use these steps in order:
  1. Bash: git rev-parse HEAD  (get SHA from the checked-out worktree)
  2. mcp__datadog-mcp__create_datadog_logpoint  (NO discover step — go straight to create)
  3. Bash: sleep 120
  4. mcp__datadog-mcp__search_datadog_logs
  5. mcp__datadog-mcp__delete_datadog_session

Do NOT call discover_datadog_logpoint — skip it entirely.
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

### Step 1 — Get SHA and resolve the APM service name

Run: Bash git rev-parse HEAD
This gives the git SHA of the deployed code to instrument.

Search the codebase for the changed function. Then trace from the function's package to
the main.go that imports it and extract the service name from ddapp.NewApp(...), appName
constants, or DD_SERVICE env vars. The APM service name is often NOT the directory name.

Also determine the repository URL from the git remote:
  Bash: git remote get-url origin

### Step 2 — Call create_datadog_logpoint directly (NO discover)

Arguments:
- service_name: the resolved APM service name
- repository_url: from git remote (strip .git suffix if present)
- git_sha: from step 1
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

### Step 3 — Wait 2 minutes

Run: Bash sleep 120

### Step 4 — Collect captured data

Call mcp__datadog-mcp__search_datadog_logs to fetch the captured logpoint data.
Use use_log_patterns: true for clustering.

Do NOT request extra_fields: ['debugger*'] — snapshots are enormous.

### Step 5 — Clean up

Call mcp__datadog-mcp__delete_datadog_session with the session_id from step 2.

### Step 6 — Return results

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

4. **Post the report** as a PR comment using post_pr_comment. This is REQUIRED.

The PR comment MUST follow this exact format. Keep it concise — no walls of text.

---

## 🔬 Autotest: [PASS or FAIL] — [one-line summary of what was validated]

**[X scenarios executed] · [Y prod inputs captured] · [Z suspicious findings]**

<details>
<summary>What changed</summary>

2-5 bullet points on what the PR modifies.

</details>

<details>
<summary>Production data</summary>

One short paragraph: what the live debugger captured (service, function, volume,
input patterns). If capture was skipped, say why in one line.

</details>

### Findings

If PASS (no suspicious findings):
> ✅ No suspicious regressions detected. All [X] scenarios passed.

If FAIL (suspicious findings found), for each finding:

#### ⚠️ [Short title]

| Field | Value |
|---|---|
| **Input** | [scenario that triggers it] |
| **Expected** | [what should happen] |
| **Actual** | [what happened — crash, wrong output, error] |

**Why it matters:** One sentence explaining the production impact.

<details>
<summary>Scenarios executed</summary>

Bullet list. Mark each as (prod input) or (synthetic).

</details>

<details>
<summary>Execution log</summary>

MANDATORY: Paste the raw terminal output from your test/validation commands here.
This is the PROOF that code was actually executed — without this section, the report
has no credibility. Include the full command and its output, for example:

\`\`\`
$ go test -run TestAutotest -v ./path/to/package/
=== RUN   TestAutotest/scenario_name
    Expected: 5, Got: 0
--- FAIL: TestAutotest/scenario_name (0.00s)
FAIL
\`\`\`

If you could NOT execute code (build failures, missing deps), say so explicitly and
explain what you tried. Do NOT fabricate test output.

</details>

<details>
<summary>Validation gaps</summary>

What you could not validate and why. If none, omit this section.

</details>

---

*🤖 Validated by [Datadog Autotest](https://github.com/DataDog/datadog-ci) using real production inputs via Live Debugger*

---

Important formatting rules:
- Use PASS when there are zero suspicious findings. Use FAIL when there are any.
- The header line is the most important — it must be scannable in a PR notification email.
- Use <details> to collapse verbose sections. Keep the top-level comment short.
- The findings table format is mandatory for FAIL — it lets reviewers compare at a glance.
- Do NOT include the full validation_report.md content — the PR comment is a summary.

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

    // Resolve PR info from --pr flag or CI environment.
    let prInfo: PrInfo | undefined

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

    // Fetch diff via API — no git history needed.
    this.context.stderr.write(`Fetching diff for ${prInfo.repo}#${prInfo.number}…\n`)
    let diff: string
    try {
      diff = await this.fetchDiff(prInfo)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: Failed to fetch diff: ${message}\n`)

      return 1
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
    const {query, tool, createSdkMcpServer} = await import('@anthropic-ai/claude-agent-sdk')
    const {z} = await import('zod')

    let resultText = ''
    let prCommentBody = ''
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

    const COMMENT_MARKER = '<!-- datadog-ci-autotest -->'

    const githubTools = prInfo && prInfo.provider === 'github' && githubToken
      ? (() => {
          const {repo, number: prNumber} = prInfo

          // Find existing autotest comment on this PR.
          const findExistingComment = async (): Promise<number | undefined> => {
            let page = 1
            while (page <= 10) {
              const response = await fetch(
                `${GITHUB_API_BASE}/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
                {
                  headers: {
                    Authorization: `token ${githubToken}`,
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': GITHUB_USER_AGENT,
                  },
                }
              )
              if (!response.ok) {
                return undefined
              }
              const comments = (await response.json()) as Array<{id: number; body: string}>
              const existing = comments.find((c) => c.body.includes(COMMENT_MARKER))
              if (existing) {
                return existing.id
              }
              if (comments.length < 100) {
                break
              }
              page++
            }

            return undefined
          }

          const postPrComment = tool(
            'post_pr_comment',
            'Post the validation report as a PR comment. Creates a new comment or updates the existing one.',
            {body: z.string().describe('Markdown body of the validation report')},
            async (args: {body: string}) => {
              const markedBody = `${COMMENT_MARKER}\n${args.body}`
              const existingId = await findExistingComment()

              if (existingId) {
                return githubApiFetch(
                  `/repos/${repo}/issues/comments/${existingId}`,
                  'PATCH',
                  {body: markedBody}
                )
              }

              return githubApiFetch(
                `/repos/${repo}/issues/${prNumber}/comments`,
                'POST',
                {body: markedBody}
              )
            }
          )

          return createSdkMcpServer({
            name: 'github-pr',
            version: '1.0.0',
            tools: [postPrComment],
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
        systemPrompt: SYSTEM_PROMPT + (dryRun
          ? '\n\n## DRY RUN MODE\nDo NOT post any PR comments. Do NOT use gh, curl, or any other method to post comments. Only write the report to stdout and validation_report.md.'
          : ''),
        model: MODEL,
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
            const firstLine = (block.text ?? '').split('\n')[0].slice(0, 80)
            if (firstLine) {
              spinner.text = `${prefix}${firstLine}`
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
        }
        // Accumulate all result text — the main agent's result may arrive before or after the subagent's.
        resultText += text + '\n'
      }
    }

    } finally {
      spinner.stop()
      logStream.end()
    }
    this.context.stderr.write(`Agent log saved to ${logPath}\n`)

    // Report telemetry to Datadog.
    await this.reportTelemetry(resultText, prInfo)

    const isFail = /\bFAIL\b|bug found|broken|regression/i.test(resultText)

    return {exitCode: isFail ? 1 : 0, resultText}
  }

  private async reportTelemetry(resultText: string, prInfo?: PrInfo) {
    const apiKey = process.env.DD_API_KEY
    if (!apiKey) {
      return
    }

    try {
      const isFail = /FAIL/i.test(resultText)
      const scenariosMatch = resultText.match(/(\d+)\s*scenarios?\s*executed/i)
      const prodInputsMatch = resultText.match(/(\d+)\s*prod\s*inputs?\s*captured/i)
      const findingsMatch = resultText.match(/(\d+)\s*suspicious\s*findings?/i)
      const hasExecutionLog = /Execution log/.test(resultText) && /\$\s+\w/.test(resultText)
      const method = hasExecutionLog ? 'execution' : 'static_analysis'

      const tags = [
        `result:${isFail ? 'fail' : 'pass'}`,
        `method:${method}`,
        `provider:${prInfo?.provider ?? 'unknown'}`,
        ...(prInfo ? [`repo:${prInfo.repo}`] : []),
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
      if (scenariosMatch) {
        logger.gauge('scenarios_executed', parseInt(scenariosMatch[1], 10))
      }
      if (prodInputsMatch) {
        logger.gauge('prod_inputs_captured', parseInt(prodInputsMatch[1], 10))
      }
      if (findingsMatch) {
        logger.gauge('suspicious_findings', parseInt(findingsMatch[1], 10))
      }

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
