import chalk from 'chalk'
import {Command, CommandClass} from 'clipanion'

import {messageBox} from './message-box'

export type PluginSubmodule = {PluginCommand: CommandClass}

export const executePluginCommand = async <T extends Command>(instance: T): Promise<number | void> => {
  const [scope, command] = instance.path

  try {
    const submodule = (await import(`@datadog/datadog-ci-plugin-${scope}/commands/${command}`)) as PluginSubmodule
    const pluginCommand = Object.assign(new submodule.PluginCommand(), instance)

    return pluginCommand.execute()
  } catch (error) {
    if (error && (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      console.log()
      messageBox('Plugin not installed 🔌', 'red', [
        `The ${chalk.cyan(`datadog-ci ${scope} ${command}`)} command is not installed.`,
        `To use this command, please install the ${chalk.bold.magenta(`@datadog/datadog-ci-plugin-${scope}`)} package.`,
      ])
      console.log(
        [
          '',
          `For example, you can install it using:`,
          `  ${chalk.bold('npm install')} ${chalk.magenta(`@datadog/datadog-ci-plugin-${scope}`)}`,
          `or`,
          `  ${chalk.bold('yarn add')} ${chalk.magenta(`@datadog/datadog-ci-plugin-${scope}`)}`,
          '',
        ].join('\n')
      )

      return 1
    }

    console.error(chalk.red('Unexpected error when executing plugin:'), error)

    return 1
  }
}
