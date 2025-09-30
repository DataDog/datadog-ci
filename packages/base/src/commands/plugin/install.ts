import {Command, Option} from 'clipanion'

import {installPlugin} from '../../helpers/plugin'

export class PluginInstallCommand extends Command {
  public static paths = [['plugin', 'install']]

  public static usage = Command.Usage({
    category: 'Plugins',
    description: 'Install or upgrade a plugin.',
    examples: [
      [
        'Install the plugin by passing its package name',
        'datadog-ci plugin install @datadog/datadog-ci-plugin-synthetics',
      ],
      ['Install the plugin by passing its scope', 'datadog-ci plugin install synthetics'],
    ],
  })

  // Positional
  public packageOrScope = Option.String()

  public async execute() {
    const succeeded = await installPlugin(this.packageOrScope)

    return succeeded ? 0 : 1
  }
}
