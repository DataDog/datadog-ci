import {Command} from 'clipanion'

class VersionCommand extends Command {
  public static usage = Command.Usage({
    description: 'Get the current version of datadog-ci.',
    examples: [['Get the current version of datadog-ci', 'datadog-ci version']],
  })

  public async execute() {
    const {version} = require('../../../package.json')
    this.context.stdout.write(`v${version}\n`)

    return 0
  }
}

VersionCommand.addPath('version')

module.exports = [VersionCommand]
