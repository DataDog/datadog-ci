#!/usr/bin/env node

import type {CommandContext} from '@datadog/datadog-ci-base'
import type {PluginSubModule} from '@datadog/datadog-ci-base/helpers/plugin'

import {commands as commandDeclarations} from '@datadog/datadog-ci-base/cli'
import {cliVersion} from '@datadog/datadog-ci-base/version'
import {Builtins, Cli} from 'clipanion'

import packageJson from '@datadog/datadog-ci/package.json'

export * as gitMetadata from '@datadog/datadog-ci-base/commands/git-metadata/library'
export * as utils from '@datadog/datadog-ci-base/helpers/utils'
export {cliVersion as version} from '@datadog/datadog-ci-base/version'

export const BETA_COMMANDS = new Set(['deployment', 'elf-symbols'])

const betaCommandsEnabled =
  process.env.DD_BETA_COMMANDS_ENABLED === '1' || process.env.DD_BETA_COMMANDS_ENABLED === 'true'

// Enable sourcemaps to translate stack traces
process.setSourceMapsEnabled(true)

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

// `__getInjectedPlugins` is injected by tsdown.
// SEA has all plugins, while the NPM bundle has only the builtin ones.
// In development mode, read from package.json devDependencies.
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __getInjectedPlugins:
  | (() => {
      injectedPluginSubmodules?: Record<string, Record<string, PluginSubModule>>
    })
  | undefined

const builtinPlugins =
  typeof __getInjectedPlugins !== 'undefined'
    ? Object.keys(__getInjectedPlugins().injectedPluginSubmodules ?? {}).map((s) => `@datadog/datadog-ci-plugin-${s}`)
    : Object.keys(packageJson.devDependencies).filter((plugin) => plugin.startsWith('@datadog/datadog-ci-plugin-'))

if (require.main === module) {
  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    builtinPlugins,
  })
}

export {cli}
