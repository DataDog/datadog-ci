#!/usr/bin/env node

import type {CommandContext} from '@datadog/datadog-ci-base'

import {commands as commandDeclarations} from '@datadog/datadog-ci-base/cli'
import {cliVersion, printVersion} from '@datadog/datadog-ci-base/version'
import {Builtins, Cli} from 'clipanion'

import packageJson from '@datadog/datadog-ci/package.json'

export * as gitMetadata from '@datadog/datadog-ci-base/commands/git-metadata/library'
export * as utils from '@datadog/datadog-ci-base/helpers/utils'
export {cliVersion, printVersion} from '@datadog/datadog-ci-base/version'

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

Object.entries(commandDeclarations).forEach(([scope, commands]) => {
  if (!betaCommandsEnabled && BETA_COMMANDS.has(scope)) {
    return
  }

  commands.forEach((command) => cli.register(command))
})

// In bundled mode, __INJECTED_PLUGIN_SUBMODULES__ is injected by esbuild.
// SEA has all plugins; npm bundle has only the builtin ones.
// In development mode, read from package.json devDependencies.
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __INJECTED_PLUGIN_SUBMODULES__: Record<string, Record<string, unknown>> | undefined

const builtinPlugins =
  typeof __INJECTED_PLUGIN_SUBMODULES__ !== 'undefined'
    ? Object.keys(__INJECTED_PLUGIN_SUBMODULES__).map((s) => `@datadog/datadog-ci-plugin-${s}`)
    : Object.keys(packageJson.devDependencies).filter((plugin) => plugin.startsWith('@datadog/datadog-ci-plugin-'))

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __IS_MAIN_MODULE__: boolean | undefined
const isMainModule = typeof __IS_MAIN_MODULE__ !== 'undefined' ? __IS_MAIN_MODULE__ : require.main === module

if (isMainModule) {
  printVersion()

  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    builtinPlugins,
  })
}

export {cli}
