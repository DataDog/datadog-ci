#!/usr/bin/env node

import {commands as migratedCommands} from '@datadog/datadog-ci-base/cli'
import {cliVersion} from '@datadog/datadog-ci-base/version'
import {Builtins, Cli} from 'clipanion'

import {commands as commandsToMigrate} from './commands/cli'

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

Object.entries({...migratedCommands, ...commandsToMigrate}).forEach(([scope, commands]) => {
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
