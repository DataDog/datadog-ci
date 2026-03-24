import {Command} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {detectDiffContext, getDiff} from './diff-context'

const SYSTEM_PROMPT = `You are a senior software engineer performing a code review.
Analyze the following pull request diff and provide a structured review.

Focus on:
- Bugs, logic errors, or potential runtime failures
- Security vulnerabilities (injection, auth issues, data exposure)
- Performance concerns (N+1 queries, unnecessary allocations, missing indexes)
- Error handling gaps
- Race conditions or concurrency issues

For each finding, include:
1. The file and approximate location
2. Severity (critical / warning / suggestion)
3. A clear explanation of the issue
4. A recommended fix

If the diff looks good, say so — do not invent issues.
Be concise and actionable. Do not repeat the diff back.`

const MODEL = 'claude-sonnet-4-20250514'

const MAX_DIFF_LENGTH = 512 * 1024 // 512 KB — keep within reasonable prompt size

export class AutotestCommand extends BaseCommand {
  public static paths = [['autotest']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Review the current pull request diff using a Claude AI agent.',
    details: `
      This command detects the current pull request or merge request context,
      computes the diff, and sends it to a Claude AI agent for code review.

      The agent uses the Claude Agent SDK with read-only access to your repository
      so it can cross-reference the diff against the full codebase.

      Requires the ANTHROPIC_API_KEY environment variable to be set.

      Supported CI providers:
        - GitHub Actions (pull_request / pull_request_target triggers)
        - GitLab CI (merge request pipelines)
    `,
    examples: [['Review the current PR diff', 'datadog-ci autotest']],
  })

  public async execute(): Promise<number> {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.context.stderr.write(
        'Error: ANTHROPIC_API_KEY environment variable is not set.\n' +
          'Get an API key from https://console.anthropic.com/ and export it.\n'
      )

      return 1
    }

    const diffContext = detectDiffContext()
    if (!diffContext) {
      this.context.stderr.write(
        'Error: Could not detect a pull request or merge request context.\n' +
          'Supported CI providers:\n' +
          '  - GitHub Actions: requires a pull_request or pull_request_target trigger\n' +
          '  - GitLab CI: requires a merge request pipeline (merge_request_event)\n'
      )

      return 1
    }

    this.context.stderr.write(`Detected ${diffContext.provider} — computing diff…\n`)

    let diff: string
    try {
      diff = await getDiff(diffContext)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: Failed to compute diff (${diffContext.provider}): ${message}\n`)

      return 1
    }

    if (!diff) {
      this.context.stderr.write(`No changes detected between base and head (${diffContext.provider}).\n`)

      return 0
    }

    if (diff.length > MAX_DIFF_LENGTH) {
      this.context.stderr.write(
        `Warning: Diff is ${(diff.length / 1024).toFixed(0)} KB — truncating to ${MAX_DIFF_LENGTH / 1024} KB to stay within prompt limits.\n`
      )
      diff = diff.slice(0, MAX_DIFF_LENGTH) + '\n\n[… diff truncated …]\n'
    }

    this.context.stderr.write('Starting AI review…\n')

    try {
      return await this.runReview(diff)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: AI review failed: ${message}\n`)

      return 1
    }
  }

  private async runReview(diff: string): Promise<number> {
    const {query} = await import('@anthropic-ai/claude-agent-sdk')

    const userPrompt = `Here is the pull request diff to review:\n\n\`\`\`diff\n${diff}\n\`\`\``

    for await (const message of query({
      prompt: userPrompt,
      options: {
        allowedTools: ['Read', 'Glob', 'Grep'],
        systemPrompt: SYSTEM_PROMPT,
        model: MODEL,
      },
    })) {
      if (isAssistantMessage(message)) {
        for (const block of message.content ?? []) {
          if (block.type === 'text') {
            this.context.stdout.write(block.text)
          }
        }
      }

      if (isResultMessage(message)) {
        this.context.stdout.write(message.result + '\n')
      }
    }

    return 0
  }
}

interface AssistantMessage {
  type: 'assistant'
  content?: Array<{type: string; text?: string}>
}

interface ResultMessage {
  type: 'result'
  result: string
}

const isAssistantMessage = (msg: unknown): msg is AssistantMessage =>
  typeof msg === 'object' && msg !== null && (msg as any).type === 'assistant'

const isResultMessage = (msg: unknown): msg is ResultMessage =>
  typeof msg === 'object' && msg !== null && (msg as any).type === 'result'
