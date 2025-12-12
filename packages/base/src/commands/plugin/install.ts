import {Command, Option} from 'clipanion'

import {messageBox} from '../../helpers/message-box'
import {installPlugin, scopeToPackageName} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class PluginInstallCommand extends BaseCommand {
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
    const packageName = scopeToPackageName(this.packageOrScope)

    if (this.context.builtinPlugins.includes(packageName)) {
      console.log()
      messageBox('Built-in plugin 🔌', 'green', [`The plugin ${packageName} is already built-in!`])
      console.log()

      return 0
    }

    const succeeded = await installPlugin(packageName)

    return succeeded ? 0 : 1
  }
}
