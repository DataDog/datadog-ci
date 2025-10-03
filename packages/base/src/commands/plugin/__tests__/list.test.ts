import {Cli} from 'clipanion'

import {createMockContext} from '../../../helpers/__tests__/testing-tools'
import {listAllPlugins} from '../../../helpers/plugin'

import {CommandContext} from '../../..'
import {PluginListCommand} from '../list'

describe('PluginListCommand', () => {
  test.each([
    ['', 'All plugins are currently built-in. We will start splitting them in next major release.\n'],
    [' (--json)', '[]\n'],
  ])('all plugins are built-in%s', async (jsonArg, expectedOutput) => {
    const cli = new Cli<CommandContext>()
    cli.register(PluginListCommand)

    const context = createMockContext() as CommandContext
    context.builtinPlugins = listAllPlugins()

    const code = await cli.run(['plugin', 'list', ...(jsonArg ? ['--json'] : [])], context)

    expect(context.stdout.toString()).toStrictEqual(expectedOutput)
    expect(code).toBe(0)
  })

  test.each([
    [
      '',
      `The following plugins are available:\n\n - @datadog/datadog-ci-plugin-aas (install with datadog-ci plugin install aas)\n`,
    ],
    [' (--json)', `[{"name":"@datadog/datadog-ci-plugin-aas","scope":"aas"}]\n`],
  ])('list available plugins%s', async (jsonArg, expectedOutput) => {
    const cli = new Cli<CommandContext>()
    cli.register(PluginListCommand)

    const context = createMockContext() as CommandContext
    context.builtinPlugins = listAllPlugins().filter(
      // Arbitrarily remove a plugin from the list of built-in plugins.
      // This simulates `@datadog/datadog-ci` having all plugins listed as dependencies, except one.
      (plugin) => plugin !== '@datadog/datadog-ci-plugin-aas'
    )

    const code = await cli.run(['plugin', 'list', ...(jsonArg ? ['--json'] : [])], context)

    expect(context.stdout.toString()).toStrictEqual(expectedOutput)
    expect(code).toBe(0)
  })
})
