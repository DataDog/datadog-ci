import fs from 'fs'

import {baseCommands} from '@datadog/datadog-ci-base/cli'
import {Builtins, Cli, CommandClass} from 'clipanion'

import {cliVersion} from './version'

export const BETA_COMMANDS = new Set(['dora', 'deployment', 'elf-symbols'])

const betaCommandsEnabled =
  process.env.DD_BETA_COMMANDS_ENABLED === '1' || process.env.DD_BETA_COMMANDS_ENABLED === 'true'

const onError = (err: any) => {
  console.log(err)
  process.exitCode = 1
}

process.on('uncaughtException', onError)
process.on('unhandledRejection', onError)

const cli = new Cli({
  binaryLabel: 'Datadog CI',
  binaryName: 'datadog-ci',
  binaryVersion: cliVersion,
})

cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

// Commands not migrated yet
const commandsPath = `${__dirname}/commands`
for (const commandFolder of fs.readdirSync(commandsPath)) {
  if (!betaCommandsEnabled && BETA_COMMANDS.has(commandFolder)) {
    continue
  }

  const commandPath = `${commandsPath}/${commandFolder}`
  if (fs.statSync(commandPath).isDirectory()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ;(require(`${commandPath}/cli`) as CommandClass[]).forEach((command) => cli.register(command))
  }
}

// Commands migrated to the `@datadog/datadog-ci-base` package
Object.entries(baseCommands).forEach(([scope, commands]) => {
  if (!betaCommandsEnabled && BETA_COMMANDS.has(scope)) {
    return
  }

  commands.forEach((command) => cli.register(command))
})

if (require.main === module) {
  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  })
}

export {cli}
