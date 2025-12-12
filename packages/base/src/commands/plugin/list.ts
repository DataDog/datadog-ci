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
    `,
    examples: [
      ['List the available plugins', 'datadog-ci plugin list'],
      ['List all plugins, including built-in plugins', 'datadog-ci plugin list --all'],
    ],
  })

  // Positional
  public json = Option.Boolean('--json', {required: false})
  public all = Option.Boolean('-a,--all', {required: false})

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public async execute() {
    const allPlugins = listAllPlugins()
    const builtinPlugins = new Set(this.context.builtinPlugins)
    const installablePlugins = allPlugins.filter((name) => !builtinPlugins.has(name))

    const plugins: {name: string; isBuiltin: boolean}[] = this.all
      ? [
          ...installablePlugins.map((name) => ({name, isBuiltin: false})),
          ...Array.from(builtinPlugins).map((name) => ({name, isBuiltin: true})),
        ]
      : installablePlugins.map((name) => ({name, isBuiltin: false}))

    if (this.json) {
      this.logger.info(
        JSON.stringify(
          plugins.map(({name, isBuiltin}) => ({
            name,
            scope: getScope(name),
            isBuiltin,
          }))
        )
      )

      return 0
    }

    this.logger.info(`The following plugins are available:\n`)
    this.logger.info(
      plugins
        .map(({name, isBuiltin}) =>
          isBuiltin
            ? ` - ${chalk.bold('(built-in)')} ${chalk.magenta(name)}`
            : ` - ${chalk.bold.magenta(name)} (install with ${chalk.bold.cyan(`datadog-ci plugin install ${getScope(name)}`)})`
        )
        .join('\n')
    )

    return 0
  }
}

const getScope = (plugin: string): string => plugin.replace('@datadog/datadog-ci-plugin-', '')
