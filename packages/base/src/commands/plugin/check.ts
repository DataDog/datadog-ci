import {Command, Option} from 'clipanion'

import {checkPlugin} from '../../helpers/plugin'

export class CheckCommand extends Command {
  public static paths = [['plugin', 'check']]

  public static usage = Command.Usage({
    category: 'Plugin',
    description: 'Check the plugin.',
    examples: [
      ['Check the plugin by passing its package name', 'datadog-ci plugin check @datadog/datadog-ci-plugin-synthetics'],
      ['Check the plugin by passing its scope', 'datadog-ci plugin check synthetics'],
      ['Check the plugin by passing its scope and one of its commands', 'datadog-ci plugin check synthetics run-tests'],
    ],
  })

  // Positional
  public args = Option.Rest({
    required: 1,
  })

  public async execute() {
    const {scope, command} = parseScopeAndCommand(this.args)
    const succeeded = await checkPlugin(scope, command)

    return succeeded ? 0 : 1
  }
}

const parseScopeAndCommand = (restParameters: string[]): {scope: string; command?: string} => {
  if (restParameters.length === 1) {
    return {scope: restParameters[0]}
  }

  return {scope: restParameters[0], command: restParameters[1]}
}
