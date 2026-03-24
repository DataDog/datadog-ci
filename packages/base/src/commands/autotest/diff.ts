import {Command} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {detectDiffContext, getDiff} from './diff-context'

export class AutotestDiffCommand extends BaseCommand {
  public static paths = [['autotest', 'diff']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Output the diff for the current pull request or merge request.',
    details: `
      This command outputs the unified diff of the current pull request or merge request.
      It is designed to run in a CI job context.

      Supported CI providers:
        - GitHub Actions (pull_request / pull_request_target triggers)
        - GitLab CI (merge request pipelines)

      The command detects the CI provider automatically, resolves the base and head
      commits, then runs \`git diff\` between them.
    `,
    examples: [['Print the PR/MR diff', 'datadog-ci autotest diff']],
  })

  public async execute(): Promise<number> {
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

    try {
      const diff = await getDiff(diffContext)

      if (!diff) {
        this.context.stderr.write(`No changes detected between base and head (${diffContext.provider}).\n`)

        return 0
      }

      this.context.stdout.write(diff)

      return 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`Error: Failed to compute diff (${diffContext.provider}): ${message}\n`)

      return 1
    }
  }
}
