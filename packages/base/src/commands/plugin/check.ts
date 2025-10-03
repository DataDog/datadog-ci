import {Command, Option} from 'clipanion'

import {checkPlugin} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class PluginCheckCommand extends BaseCommand {
  public static paths = [['plugin', 'check']]

  public static usage = Command.Usage({
    category: 'Plugins',
    description: 'Check and troubleshoot the installation of a plugin.',
    examples: [
      ['Check the plugin by passing its package name', 'datadog-ci plugin check @datadog/datadog-ci-plugin-synthetics'],
      ['Check the plugin by passing its scope', 'datadog-ci plugin check synthetics'],
      ['Check the plugin by passing its scope and one of its commands', 'datadog-ci plugin check synthetics run-tests'],
    ],
  })

  // Positional
  public packageOrScope = Option.String()
  public command = Option.String({required: false})

  public async execute() {
    const succeeded = await checkPlugin(this.packageOrScope, this.command)

    return succeeded ? 0 : 1
  }
}
