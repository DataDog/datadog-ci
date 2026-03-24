import {createWriteStream, mkdirSync} from 'fs'
import {join} from 'path'

import {exec} from 'child_process'
import {promisify} from 'util'

import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {detectDiffContext, getDiff} from './diff-context'

const PROD_DATA_COLLECTOR_PROMPT = `You are a production data collector. Your ONLY job is to capture live
production inputs for specific functions using the Datadog Live Debugger MCP tools.

You will receive a PR diff. For each function that has meaningful logic changes in a deployed
service, capture its live production inputs. Work fully autonomously — never ask for
confirmation.

Follow these steps for each function:

1. LOCATE: Find the changed function in the codebase.

2. RESOLVE SERVICE NAME: The APM service name is often NOT the directory name. Trace from
   the function's package to the main.go that imports it, then extract the name from
   ddapp.NewApp(...), appName constants, or DD_SERVICE env vars.

3. DISCOVER: Call discover_datadog_logpoint with:
   - Repository URL: MUST include .git suffix (e.g. https://github.com/DataDog/dd-go.git)
   - If discovery fails with the resolved name, try the directory name as fallback

4. CREATE LOGPOINT: Call create_datadog_logpoint with:
   - File path: Start with shortest package-relative path (e.g. processor/processor.go).
     If "no runtime_path found", try progressively longer prefixes
   - Message template: {param} syntax. Dot notation accesses FIELDS not methods.
     For interfaces, capture the whole object {obj}. Skip context objects and channels
   - Go/Ruby: conditions are NOT supported — never set one
   - Environment: prefer staging when available

5. WAIT: Sleep for 60 seconds to collect data.

6. COLLECT: Run in parallel:
   - search_datadog_logs with use_log_patterns: true
   - analyze_datadog_logs SQL for total count and top distinct messages
   Do NOT request extra_fields: ['debugger*'] — too large.

7. CLEAN UP: Delete the session.

8. RETURN: A structured summary of captured inputs including:
   - total captures
   - representative sample inputs (3-5 diverse examples)
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
    description: 'GitHub PR URL to validate. Uses `gh pr diff` to fetch the diff.',
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

    if (this.pr) {
      // Fetch diff from GitHub via `gh pr diff`.
      this.context.stderr.write(`Fetching diff from ${this.pr}…\n`)
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
      return await this.runReview(diff)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: AI review failed: ${message}\n`)

      return 1
    }
  }

  private async fetchPrDiff(prUrl: string): Promise<string> {
    const execAsync = promisify(exec)
    // Extract owner/repo and PR number from URL.
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (!match) {
      throw new Error(`Invalid GitHub PR URL: ${prUrl}`)
    }
    const [, repo, prNumber] = match
    const cwd = process.env.AUTOTEST_REPO_DIR || process.cwd()
    const {stdout} = await execAsync(`gh pr diff ${prNumber} --repo ${repo}`, {
      maxBuffer: 50 * 1024 * 1024,
      cwd,
    })

    return stdout
  }

  private async runReview(diff: string): Promise<number> {
    const {query} = await import('@anthropic-ai/claude-agent-sdk')

    const userPrompt = `Here is the pull request diff to validate:\n\n\`\`\`diff\n${diff}\n\`\`\``

    // Raw log file for full agent trace.
    const logDir = process.env.AUTOTEST_REPO_DIR || process.cwd()
    const logPath = join(logDir, '.autotest-agent.log')
    const logStream = createWriteStream(logPath, {flags: 'w'})
    const log = (entry: string) => logStream.write(`[${new Date().toISOString()}] ${entry}\n`)
    log(`Starting autotest validation`)

    const spinner = new Spinner(this.context.stderr)
    spinner.start('Connecting…')

    for await (const message of query({
      prompt: userPrompt,
      options: {
        mcpServers: {
          'datadog-mcp': {
            type: 'http',
            url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=core,live-debugger',
            headers: {
              'DD-API-KEY': process.env.DD_API_KEY ?? '',
              'DD-APPLICATION-KEY': process.env.DD_APPLICATION_KEY ?? '',
            },
          },
        },
        cwd: logDir,
        allowedTools: ['*'],
        permissionMode: 'bypassPermissions',
        systemPrompt: SYSTEM_PROMPT,
        model: MODEL,
        agents: {
          'prod-data-collector': {
            description:
              'Captures live production inputs for changed functions using Datadog Live Debugger. Takes 1-2 minutes. Start immediately and in the background.',
            prompt: PROD_DATA_COLLECTOR_PROMPT,
            tools: ['Read', 'Grep', 'Glob', 'Bash', 'mcp__datadog-mcp__*'],
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
          spinner.update(status === 'connected' ? `MCP "${name}" connected` : `MCP "${name}": ${status}`)
        }
      }

      if (isAssistantMessage(message)) {
        const content = msg.message?.content ?? msg.content ?? []
        for (const block of content) {
          if (block.type === 'text') {
            const firstLine = (block.text ?? '').split('\n')[0].slice(0, 80)
            if (firstLine) {
              spinner.update(firstLine)
            }
          }
          if (block.type === 'tool_use') {
            spinner.update((block as any).name ?? '')
          }
        }
      }

      if (isResultMessage(message)) {
        spinner.stop()
        this.context.stdout.write(msg.result + '\n')
      }
    }

    spinner.stop()
    logStream.end()
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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

class Spinner {
  private stream: NodeJS.WritableStream
  private timer: ReturnType<typeof setInterval> | undefined
  private frameIdx = 0
  private label = ''
  private running = false

  constructor(stream: NodeJS.WritableStream) {
    this.stream = stream
  }

  start(label: string) {
    this.label = label
    this.running = true
    this.render()
    this.timer = setInterval(() => this.render(), 80)
  }

  update(label: string) {
    this.label = label
    if (!this.running) {
      this.start(label)
    }
  }

  stop() {
    if (!this.running) {
      return
    }
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    // Clear the spinner line.
    this.stream.write('\r\x1b[K')
  }

  private render() {
    const frame = SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length]
    this.frameIdx++
    this.stream.write(`\r\x1b[K${frame} ${this.label}`)
  }
}
