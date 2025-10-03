import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {LogLevel, Logger} from '../../helpers/logger'
import {listAllPlugins} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class PluginListCommand extends BaseCommand {
  public static paths = [['plugin', 'list']]

  public static usage = Command.Usage({
    category: 'Plugins',
    description: 'List the available plugins.',
    details: `
      This command lists the plugins that can be installed with the \`datadog-ci plugin install\` command.

      All other plugins are **built-in** and are not listed here.
    `,
    examples: [['List the available plugins', 'datadog-ci plugin list']],
  })

  // Positional
  public json = Option.Boolean('--json', {required: false})

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public async execute() {
    const allPlugins = listAllPlugins()
    const builtinPlugins = new Set(this.context.builtinPlugins)
    const installablePlugins = allPlugins.filter((plugin) => !builtinPlugins.has(plugin))

    if (this.json) {
      this.logger.info(
        JSON.stringify(
          installablePlugins.map((plugin) => ({
            name: plugin,
            scope: getScope(plugin),
          }))
        )
      )

      return 0
    }

    if (installablePlugins.length === 0) {
      this.logger.info('All plugins are currently built-in. We will start splitting them in next major release.')

      return 0
    }

    this.logger.info(`The following plugins are available:\n`)
    this.logger.info(
      installablePlugins
        .map(
          (plugin) =>
            ` - ${chalk.bold.magenta(plugin)} (install with ${chalk.bold.cyan(`datadog-ci plugin install ${getScope(plugin)}`)})`
        )
        .join('\n')
    )

    return 0
  }
}

const getScope = (plugin: string): string => plugin.replace('@datadog/datadog-ci-plugin-', '')
