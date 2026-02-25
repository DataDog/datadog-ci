import {Command} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'

import {cliVersion} from '../../version'

export class VersionCommand extends BaseCommand {
  public static paths = [['version']]

  public static usage = Command.Usage({
    // This description is longer than usual because this is valuable information, and it's unlikely
    // that the user is going to run `datadog-ci version --help`. This description will show in `datadog-ci --help` instead.
    description:
      'Get the current version of datadog-ci. This command outputs a prefixed version, e.g. `v1.0.0`. If you want the raw version, use `datadog-ci --version`.',
  })

  public async execute() {
    this.context.stdout.write(`v${cliVersion}\n`)

    return 0
  }
}
