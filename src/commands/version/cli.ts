import {Command} from 'clipanion'

import {version} from '../../helpers/version'

class VersionCommand extends Command {
  public static paths = [['version']]

  public static usage = Command.Usage({
    description: 'Get the current version of datadog-ci.',
    examples: [['Get the current version of datadog-ci', 'datadog-ci version']],
  })

  public async execute() {
    this.context.stdout.write(`v${version}\n`)

    return 0
  }
}

module.exports = [VersionCommand]
