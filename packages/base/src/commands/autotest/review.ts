import {createWriteStream, mkdirSync} from 'fs'
import {join} from 'path'

import {exec} from 'child_process'
import {promisify} from 'util'

import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {detectDiffContext, getDiff} from './diff-context'

const SYSTEM_PROMPT = `You are an AI code validation agent running inside CI for a pull request.

Your job is to determine whether this PR introduces suspicious behavioral regressions by executing the code on realistic, high-value scenarios. Do not do static code review. Do not give style feedback. Only report issues that are grounded in code execution.

You are working in a repository with two available git states:
- HEAD worktree: the pull request branch
- BASE worktree: the base branch before the PR

You may inspect code, inspect tests, create temporary files, run tests, and compare behavior between BASE and HEAD.

Your goal is to produce a short markdown report with:
1. a brief summary of what behavior this PR appears to change
2. what scenarios you tested
3. only the suspicious behavior changes you found, with concrete evidence
4. a short note on anything you could not validate

Important constraints:
- Prefer execution over speculation.
- Only flag something if it is based on an actual run of the code.
- Suppress behavior differences that are clearly intended by the PR.
- Keep all generated files temporary and isolated. Do not modify existing tracked files unless absolutely necessary for the validation, and if you do, keep changes minimal and only inside the HEAD worktree.
- Prefer writing temporary tests or temporary validation scripts rather than permanently restructuring the code.
- Reuse existing test helpers, fixtures, mocks, and conventions whenever possible.
- Keep scope tight: focus on 1 or 2 high-risk changed areas, not the whole PR.
- Test a small number of high-value scenarios, roughly 5 to 10.
- Prefer package-level or unit-level execution that is reliable in CI.
- Avoid fragile end-to-end setups unless they are already trivial in this repo.

You should follow this workflow:

Step 1: Understand the PR
- Read the diff and nearby code.
- Determine:
  - what behavior the PR is likely intended to change
  - what behavior should likely remain unchanged
  - what the riskiest changed logic is
- Focus on concrete runtime risks such as:
  - retries
  - duplicate handling
  - malformed inputs
  - fallback paths
  - error handling
  - state transitions
  - classification / transformation changes
  - edge-case parsing / normalization
- Also inspect nearby existing tests to understand how this code is normally exercised.

Step 2: Pick one or two target entrypoints
- Choose the most practical function, method, package test surface, or script entrypoint to exercise the changed behavior.
- Prefer the narrowest executable surface that still covers the risky changed logic.

Step 3: Build realistic test scenarios
- Look for existing fixtures, test cases, sample payloads, or representative inputs in the repo.
- If available, use production-like sample inputs from the provided fixture directory or context.
- Create a small set of realistic challenge scenarios around the changed behavior.
- Prefer scenarios that would reveal unintended regressions, not just happy paths.
- Examples of useful scenarios:
  - duplicate inputs
  - missing optional fields
  - malformed but plausible payloads
  - boundary values
  - retry-like or repeated calls
  - empty / partial / reordered collections
  - strictness changes in parsing or validation
- If you synthesize new inputs, keep them realistic and close to existing fixtures or observed shapes.

Step 4: Create temporary validation code
- Create temporary tests or a temporary validation script in an isolated temporary location.
- Prefer one concise table-driven temporary test file over many files.
- Keep the assertions focused on meaningful behavior:
  - return values
  - errors
  - selected output fields
  - stable normalized output
- Do not overfit to formatting differences.
- If needed, add lightweight normalization in the temporary test to ignore unstable or irrelevant fields.
- If a direct comparison to BASE and HEAD is easiest through a helper script, do that.

Step 5: Execute on HEAD and BASE
- Run the same validation scenarios against the HEAD worktree and the BASE worktree.
- Capture concrete outputs for each scenario.
- Compare results carefully.
- Distinguish:
  - clearly intended behavior changes
  - suspicious unexpected regressions
- A suspicious regression is something that appears inconsistent with the likely purpose of the PR and would plausibly matter in production.

Step 6: Produce final report
Write a markdown file named validation_report.md with this structure:

# AI Validation Report

## PR behavior summary
2 to 5 bullet points on what the PR appears to change.

## Scenarios tested
A short bullet list of the scenarios you exercised.

## Suspicious findings
For each suspicious finding:
- short title
- why it is suspicious
- scenario/input summary
- BASE behavior
- HEAD behavior

If there are no suspicious findings, say so clearly.

## Expected changes observed
List notable behavior changes that appear intentional and were not flagged.

## Validation gaps
Short list of anything important you could not validate.

Also save any generated temporary tests or scripts so a human can inspect them.

Be pragmatic:
- It is better to validate one important changed behavior well than to weakly validate many things.
- If the repo setup is difficult, adapt by choosing a narrower surface.
- If you cannot reliably execute a scenario, do not bluff. Say you could not validate it.

You have access to:
- the PR diff
- the repository
- the HEAD worktree
- the BASE worktree
- any provided production-like fixtures or sample inputs

---

## Capturing live production inputs

You have access to Datadog Live Debugger via MCP tools (discover_datadog_logpoint,
create_datadog_logpoint, etc.). Use these tools directly — do NOT try to invoke a
skill. The instructions below tell you how to use these MCP tools.

Capture runtime inputs to a function in a deployed service using Datadog Live Debugger.
Run fully autonomously with no human interaction — never ask for confirmation or
clarification. Make best-effort decisions at every step.

You MUST capture live production inputs for every PR that modifies function logic in a
deployed service.
Before building any test scenarios, capture live production inputs for the key changed
functions. Use these real inputs as test fixtures — they are far more valuable than
synthetic ones. Only skip this if the changed code is clearly not deployed (e.g. CLI
tooling, build scripts, documentation).

### Step 1 — Locate the function

Search the codebase for the function. If only a description is given, search broadly and
pick the best match — prefer functions that receive decoded business-logic data over raw
transport-level data. If multiple candidates exist, pick the one closest to core business
logic without asking.

### Step 2 — Resolve the APM service name

The APM service name is often NOT the directory name. Trace from the function's package to
the main.go that imports it, then extract the name from ddapp.NewApp(...), appName constants,
or DD_SERVICE env vars.

### Step 3 — Discover and create the logpoint

Call discover_datadog_logpoint then create_datadog_logpoint. Hard-won learnings:

- **Repository URL**: MUST include .git suffix (e.g. https://github.com/DataDog/dd-go.git) — other formats fail
- **File path**: Start with the shortest package-relative path (e.g. processor/processor.go), not the full repo path. If it fails with "no runtime_path found", try progressively longer prefixes automatically
- **Service name fallback**: If discovery fails with the resolved name, try the directory name
- **Message template**: {param} syntax. Dot notation accesses fields not methods. For interfaces/abstract types capture the whole object {obj}. Skip context objects, callbacks, and channels
- **Go/Ruby**: Conditions are not supported — never set one
- **Environment**: Prefer staging when available

### Step 4 — Collect and analyze

Wait for the requested duration (default 1m). Then run in parallel:
- search_datadog_logs with use_log_patterns: true for clustering
- analyze_datadog_logs SQL for total count, host distribution, and top distinct messages

Do NOT request extra_fields: ['debugger*'] — snapshots are enormous and a single capture
can blow through token limits. Default fields with message template output are sufficient.

### Step 5 — Clean up and report

Disable the logpoint. Return: total captures, common input patterns (which params vary vs
constant), distinct traffic classes with percentages, and notable observations.

Start now by:
1. reading the diff
2. identifying the highest-risk changed behavior
3. using the Datadog Live Debugger MCP tools to capture real production inputs for the changed functions
4. using those captured inputs as test fixtures to build and run a temporary validation
5. writing validation_report.md`

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
