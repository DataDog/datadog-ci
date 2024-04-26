import {Builtins, CommandClass} from 'clipanion'

// Test all commands, including beta ones.
process.env.DD_BETA_COMMANDS_ENABLED = '1'

import {cli, BETA_COMMANDS} from '../cli'

const builtins: CommandClass[] = [Builtins.HelpCommand, Builtins.VersionCommand]

describe('cli', () => {
  describe('all commands have the right metadata', () => {
    const commands = Array.from(cli['registrations'].keys())
    const userDefinedCommands = commands.filter((command) => !builtins.includes(command))

    const cases: [string, [string, CommandClass][]][] = Object.entries(
      userDefinedCommands.reduce((acc, command) => {
        const rootCommand = command.paths?.[0][0] || 'unknown' // e.g. synthetics
        const commandName = BETA_COMMANDS.includes(rootCommand) ? `${rootCommand} (beta)` : rootCommand
        const subcommandName = command.paths?.[0].slice(1).join(' ') ?? '<root>' // e.g. run-tests
        const newCase: [string, CommandClass] = [subcommandName, command]

        return {
          ...acc,
          [commandName]: [...(acc[commandName] ?? []), newCase],
        }
      }, {} as Record<string, [string, CommandClass][]>)
    )

    describe.each(cases)('%s', (commandName, subcommandCases) => {
      test.each(subcommandCases)('%s', (_, command) => {
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
  })
})
