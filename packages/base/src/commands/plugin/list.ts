import {Command, Option} from 'clipanion'

import {listAllPlugins} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class PluginListCommand extends BaseCommand {
  public static paths = [['plugin', 'list']]

  public static usage = Command.Usage({
    category: 'Plugins',
    description: 'List the available plugins.',
    details: `
      This command lists the plugins that can be installed with the \`datadog-ci plugin install\` command.

      All other plugins are considered **built-in** and are not listed.
    `,
    examples: [['List the available plugins', 'datadog-ci plugin list']],
  })

  // Positional
  public json = Option.Boolean('--json', {required: false})

  public async execute() {
    const allPlugins = listAllPlugins()
    const builtinPlugins = new Set(this.context.builtinPlugins)
    const installablePlugins = allPlugins.filter((plugin) => !builtinPlugins.has(plugin))

    if (this.json) {
      console.log(JSON.stringify(installablePlugins))
    } else {
      console.log(installablePlugins.join('\n'))
    }

    return 0
  }
}
