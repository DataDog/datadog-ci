import fs from 'fs'

import {Builtins, Cli} from 'clipanion'
import {CommandClass} from 'clipanion/lib/advanced/Command'

import {version} from './helpers/version'

export const BETA_COMMANDS = ['dora', 'deployment', 'elf-symbols', 'coverage']

const onError = (err: any) => {
  console.log(err)
  process.exitCode = 1
}

process.on('uncaughtException', onError)
process.on('unhandledRejection', onError)

const cli = new Cli({
  binaryLabel: 'Datadog CI',
  binaryName: 'datadog-ci',
  binaryVersion: version,
})

cli.register(Builtins.HelpCommand)
cli.register(Builtins.VersionCommand)

const commandsPath = `${__dirname}/commands`
for (const commandFolder of fs.readdirSync(commandsPath)) {
  const betaCommandsEnabled =
    process.env.DD_BETA_COMMANDS_ENABLED === '1' || process.env.DD_BETA_COMMANDS_ENABLED === 'true'
  if (BETA_COMMANDS.includes(commandFolder) && !betaCommandsEnabled) {
    continue
  }
  const commandPath = `${commandsPath}/${commandFolder}`
  if (fs.statSync(commandPath).isDirectory()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ;(require(`${commandPath}/cli`) as CommandClass[]).forEach((command) => cli.register(command))
  }
}

if (require.main === module) {
  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  })
}

export {cli}
