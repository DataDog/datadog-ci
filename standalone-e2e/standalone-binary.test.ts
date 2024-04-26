import {exec} from 'child_process'
import {promisify} from 'util'

// Test all commands, including beta ones.
process.env.DD_BETA_COMMANDS_ENABLED = '1'

import {cli, BETA_COMMANDS} from '../src/cli'
import {Builtins, CommandClass} from 'clipanion'

import {version} from '../package.json'

const execPromise = promisify(exec)

const isWin = process.platform === 'win32'
const os = isWin ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'

const STANDALONE_BINARY = `datadog-ci_${os}-x64`
const STANDALONE_BINARY_PATH = `${isWin ? '.\\' : './'}${STANDALONE_BINARY}${isWin ? '.exe' : ''}`

const sanitizeOutput = (output: string) => output.replace(/(\r\n|\n|\r)/gm, '')

const timeoutPerPlatform: Record<typeof os, number> = {
  // Some macOS agents sometimes run slower, making this test suite flaky on macOS only.
  // The issue is tracked here: https://github.com/actions/runner-images/issues/3885
  darwin: 10 * 1000,
  // Keep the default timeout for Linux.
  linux: 5 * 1000,
  // Running the binary on Windows is also slower than on Linux, and sometimes times out by a very small margin.
  win: 10 * 1000,
}

describe('standalone binary', () => {
  jest.setTimeout(timeoutPerPlatform[os])

  describe('version', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} version`)
      const binaryVersion = sanitizeOutput(stdout)
      // .slice(1) to remove the "v"
      expect(binaryVersion.slice(1)).toEqual(version)
    })
  })

  const builtins: CommandClass[] = [Builtins.HelpCommand, Builtins.VersionCommand]
  const commands = Array.from(cli['registrations'].keys())
  const userDefinedCommands = commands.filter((command) => !builtins.includes(command))

  const cases: [string, [string, string][]][] = Object.entries(
    userDefinedCommands.reduce((acc, command) => {
      const rootCommand = command.paths?.[0][0] || 'unknown' // e.g. synthetics
      const commandName = BETA_COMMANDS.includes(rootCommand) ? `${rootCommand} (beta)` : rootCommand
      const subcommand = command.paths?.[0].slice(1).join(' ') // e.g. run-tests
      const subcommandName = subcommand ?? '<root>'
      const commandLine = `${rootCommand}${subcommand ? ` ${subcommand}` : ''} --help`
      const newCase: [string, string] = [subcommandName, commandLine]

      return {
        ...acc,
        [commandName]: [...(acc[commandName] ?? []), newCase],
      }
    }, {} as Record<string, [string, string][]>)
  )

  describe.each(cases)('%s', (_, subcommandCases) => {
    test.each(subcommandCases)('%s', async (_, commandLine) => {
      const {stdout} = await execPromise(`DD_BETA_COMMANDS_ENABLED=1 ${STANDALONE_BINARY_PATH} ${commandLine}`)
      const helpText = sanitizeOutput(stdout)
      expect(helpText).toContain(commandLine.replace('--help', ''))
    })
  })
})
