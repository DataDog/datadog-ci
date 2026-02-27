import {Cli} from 'clipanion'

import {createMockContext} from '../../../helpers/__tests__/testing-tools'
import {listAllPlugins} from '../../../helpers/plugin'

import {CommandContext} from '../../..'
import {PluginListCommand} from '../list'

describe('PluginListCommand', () => {
  test.each([
    {
      title: 'no args',
      args: [],
      expectedOutput: 'The following plugins are available:\n\n\n',
    },
    {
      title: '--json',
      args: ['--json'],
      expectedOutput: '[]\n',
    },
    {
      title: '--all',
      args: ['--all'],
      expectedOutput: `The following plugins are available:\n\n - (built-in) @datadog/datadog-ci-plugin-aas\n - (built-in) @datadog/datadog-ci-plugin-cloud-run\n - (built-in) @datadog/datadog-ci-plugin-container-app\n - (built-in) @datadog/datadog-ci-plugin-coverage\n - (built-in) @datadog/datadog-ci-plugin-deployment\n - (built-in) @datadog/datadog-ci-plugin-dora\n - (built-in) @datadog/datadog-ci-plugin-gate\n - (built-in) @datadog/datadog-ci-plugin-junit\n - (built-in) @datadog/datadog-ci-plugin-lambda\n - (built-in) @datadog/datadog-ci-plugin-sarif\n - (built-in) @datadog/datadog-ci-plugin-sbom\n - (built-in) @datadog/datadog-ci-plugin-stepfunctions\n - (built-in) @datadog/datadog-ci-plugin-synthetics\n - (built-in) @datadog/datadog-ci-plugin-terraform\n`,
    },
    {
      title: '--all --json',
      args: ['--all', '--json'],
      expectedOutput: `[{"name":"@datadog/datadog-ci-plugin-aas","scope":"aas","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-cloud-run","scope":"cloud-run","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-container-app","scope":"container-app","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-coverage","scope":"coverage","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-deployment","scope":"deployment","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-dora","scope":"dora","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-gate","scope":"gate","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-junit","scope":"junit","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-lambda","scope":"lambda","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-sarif","scope":"sarif","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-sbom","scope":"sbom","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-stepfunctions","scope":"stepfunctions","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-synthetics","scope":"synthetics","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-terraform","scope":"terraform","isBuiltin":true}]\n`,
    },
  ])('all plugins are built-in ($title)', async ({args, expectedOutput}) => {
    const cli = new Cli<CommandContext>()
    cli.register(PluginListCommand)

    const context = createMockContext() as CommandContext
    context.builtinPlugins = listAllPlugins()

    const code = await cli.run(['plugin', 'list', ...args], context)

    expect(context.stdout.toString()).toStrictEqual(expectedOutput)
    expect(code).toBe(0)
  })

  test.each([
    {
      title: 'no args',
      args: [],
      expectedOutput: `The following plugins are available:\n\n - @datadog/datadog-ci-plugin-aas (install with datadog-ci plugin install aas)\n`,
    },
    {
      title: '--json',
      args: ['--json'],
      expectedOutput: `[{"name":"@datadog/datadog-ci-plugin-aas","scope":"aas","isBuiltin":false}]\n`,
    },
    {
      title: '--all',
      args: ['--all'],
      expectedOutput: `The following plugins are available:\n\n - @datadog/datadog-ci-plugin-aas (install with datadog-ci plugin install aas)\n - (built-in) @datadog/datadog-ci-plugin-cloud-run\n - (built-in) @datadog/datadog-ci-plugin-container-app\n - (built-in) @datadog/datadog-ci-plugin-coverage\n - (built-in) @datadog/datadog-ci-plugin-deployment\n - (built-in) @datadog/datadog-ci-plugin-dora\n - (built-in) @datadog/datadog-ci-plugin-gate\n - (built-in) @datadog/datadog-ci-plugin-junit\n - (built-in) @datadog/datadog-ci-plugin-lambda\n - (built-in) @datadog/datadog-ci-plugin-sarif\n - (built-in) @datadog/datadog-ci-plugin-sbom\n - (built-in) @datadog/datadog-ci-plugin-stepfunctions\n - (built-in) @datadog/datadog-ci-plugin-synthetics\n - (built-in) @datadog/datadog-ci-plugin-terraform\n`,
    },
    {
      title: '--all --json',
      args: ['--all', '--json'],
      expectedOutput: `[{"name":"@datadog/datadog-ci-plugin-aas","scope":"aas","isBuiltin":false},{"name":"@datadog/datadog-ci-plugin-cloud-run","scope":"cloud-run","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-container-app","scope":"container-app","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-coverage","scope":"coverage","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-deployment","scope":"deployment","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-dora","scope":"dora","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-gate","scope":"gate","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-junit","scope":"junit","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-lambda","scope":"lambda","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-sarif","scope":"sarif","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-sbom","scope":"sbom","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-stepfunctions","scope":"stepfunctions","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-synthetics","scope":"synthetics","isBuiltin":true},{"name":"@datadog/datadog-ci-plugin-terraform","scope":"terraform","isBuiltin":true}]\n`,
    },
  ])('list available plugins ($title)', async ({args, expectedOutput}) => {
    const cli = new Cli<CommandContext>()
    cli.register(PluginListCommand)

    const context = createMockContext() as CommandContext
    context.builtinPlugins = listAllPlugins().filter(
      // Arbitrarily remove a plugin from the list of built-in plugins.
      // This simulates `@datadog/datadog-ci` having all plugins listed as dependencies, except one.
      (plugin) => plugin !== '@datadog/datadog-ci-plugin-aas'
    )

    const code = await cli.run(['plugin', 'list', ...args], context)

    expect(context.stdout.toString()).toStrictEqual(expectedOutput)
    expect(code).toBe(0)
  })
})
