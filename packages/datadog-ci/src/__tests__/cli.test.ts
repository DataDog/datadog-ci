import {Builtins, CommandClass} from 'clipanion'

// Test all commands, including beta ones.
process.env.DD_BETA_COMMANDS_ENABLED = '1'

import {cli, BETA_COMMANDS} from '../cli'
import {enableFips} from '../helpers/fips'

const builtins: CommandClass[] = [Builtins.HelpCommand, Builtins.VersionCommand]

jest.mock('../helpers/fips')

describe('cli', () => {
  const commands = Array.from(cli['registrations'].keys())
  const userDefinedCommands = commands.filter((command) => !builtins.includes(command))
  const commandPaths: {command: CommandClass; commandPath: string[]}[] = []
  for (const command of userDefinedCommands) {
    for (const commandPath of command.paths ?? []) {
      commandPaths.push({command, commandPath})
    }
  }

  const cases: [string, string, string[], CommandClass][] = commandPaths.map(({command, commandPath}) => {
    const [rootPath, subPath] = commandPath
    const commandName = BETA_COMMANDS.includes(rootPath) ? `${rootPath} (beta)` : rootPath // e.g. synthetics
    const subcommandName = subPath || '<root>' // e.g. run-tests

    return [commandName, subcommandName, commandPath, command]
  })

  describe('all commands have the right metadata', () => {
    test.each(cases)('%s %s', (commandName, _subcommandName, _commandPath, command) => {
      expect(command).toHaveProperty('paths')
      expect(command).toHaveProperty('usage')

      if (commandName !== 'version') {
        // Please categorize the commands by product. You can refer to the CODEOWNERS file.
        // eslint-disable-next-line jest/no-conditional-expect
        expect(command.usage).toHaveProperty('category')
      }

      // You should at least document the command with a description, otherwise it will show as "undocumented" in `--help`.
      expect(command.usage).toHaveProperty('description')

      // Please end your description with a period.
      expect(command.usage?.description).toMatch(/\.$/)

      // Please uppercase the first letter of the category and description.
      expect(command.usage?.category?.charAt(0)).toStrictEqual(command.usage?.category?.charAt(0).toUpperCase())
      expect(command.usage?.description?.charAt(0)).toStrictEqual(command.usage?.description?.charAt(0).toUpperCase())
    })
  })

  describe('fips', () => {
    const mockedEnableFips = enableFips as jest.MockedFunction<typeof enableFips>
    mockedEnableFips.mockImplementation(() => true)

    // Without the required options, the commands are not executed at all
    const requiredOptions: Record<string, string[]> = {
      'coverage upload': ['.', '--dry-run'],
      'dora deployment': ['--started-at', '0', '--dry-run'],
      'dsyms upload': ['.', '--dry-run'],
      'elf-symbols upload': ['non-existing-file', '--dry-run'],
      'pe-symbols upload': ['non-existing-file', '--dry-run'],
      'gate evaluate': ['--no-wait', '--dry-run'],
      'junit upload': ['.', '--dry-run'],
      'sarif upload': ['.', '--dry-run'],
      'sbom upload': ['.'],
      'sourcemaps upload': ['.', '--dry-run'],
      trace: ['id', '--dry-run'],
    }

    // version doesn't support --fips option
    const fipsCases = cases.filter(([commandName]) => !['version'].includes(commandName))

    describe.each(fipsCases)('%s %s', (_commandName, _subcommandName, commandPath) => {
      const command = [...commandPath, ...(requiredOptions[commandPath.join(' ')] ?? [])]

      test('supports the --fips option', async () => {
        // When running the command with the --fips option
        const exitCode = await cli.run([...command, '--fips'])

        // The command calls the enableFips function with the right parameters
        expect([0, 1]).toContain(exitCode)
        expect(mockedEnableFips).toHaveBeenCalledWith(true, false)
      })

      test('supports the --fips-ignore-error option', async () => {
        // When running the command with the --fips and --fips-ignore-error options
        const exitCode = await cli.run([...command, '--fips', '--fips-ignore-error'])

        // The command calls the enableFips function with the right parameters
        expect([0, 1]).toContain(exitCode)
        expect(mockedEnableFips).toHaveBeenCalledWith(true, true)
      })
    })
  })
})
