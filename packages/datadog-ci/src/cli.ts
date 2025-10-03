#!/usr/bin/env node

import {CommandContext} from '@datadog/datadog-ci-base'
import {commands as migratedCommands} from '@datadog/datadog-ci-base/cli'
import {cliVersion} from '@datadog/datadog-ci-base/version'
import {Builtins, Cli} from 'clipanion'

import {dependencies} from '@datadog/datadog-ci/package.json'

import {commands as commandsToMigrate} from './commands/cli'

export const BETA_COMMANDS = new Set(['deployment', 'elf-symbols'])

const betaCommandsEnabled =
  process.env.DD_BETA_COMMANDS_ENABLED === '1' || process.env.DD_BETA_COMMANDS_ENABLED === 'true'

const onError = (err: any) => {
  console.log(err)
  process.exitCode = 1
}

process.on('uncaughtException', onError)
process.on('unhandledRejection', onError)

const cli = new Cli<CommandContext>({
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

const builtinPlugins = Object.keys(dependencies).filter((plugin) => plugin.startsWith('@datadog/datadog-ci-plugin-'))

if (require.main === module) {
  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    builtinPlugins,
  })
}

export {cli}
