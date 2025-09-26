import {inspect} from 'node:util'

import chalk from 'chalk'
import {Command, CommandClass} from 'clipanion'
import createDebug from 'debug'

import {peerDependencies} from '@datadog/datadog-ci-base/package.json'

import {isStandaloneBinary} from './is-standalone-binary'
import {messageBox} from './message-box'

export type PluginPackageJson = {name: string; version: string}
export type PluginSubModule = {PluginCommand: CommandClass}

// Use `DEBUG=plugins` to enable debug logs
const debug = createDebug('plugins')

export const executePluginCommand = async <T extends Command>(instance: T): Promise<number | void> => {
  const [scope, command] = instance.path
  debug(`Executing command ${command} in plugin ${scope}`)

  try {
    const submodule = await importPluginSubmodule(scope, command)
    debug(`Done importing plugin command`)

    const pluginCommand = Object.assign(new submodule.PluginCommand(), instance)

    return pluginCommand.execute()
  } catch (error) {
    handleErrorGeneric(error, scope, command)

    const packageName = `@datadog/datadog-ci-plugin-${scope}`

    console.log(
      [
        `To troubleshoot, run:`,
        `  ${chalk.bold.cyan(`datadog-ci plugin check`)} ${chalk.magenta(packageName)}`,
        ...(command
          ? [`or`, `  ${chalk.bold.cyan(`datadog-ci plugin check`)} ${chalk.magenta(scope)} ${chalk.magenta(command)}`]
          : []),
        '',
      ].join('\n')
    )

    return 1
  }
}

export const checkPlugin = async (scope: string, command?: string): Promise<boolean> => {
  if (!(scopeToPackageName(scope) in peerDependencies)) {
    console.log(
      [
        '',
        chalk.bold.red("This plugin is not listed as a possible peer dependency. Make sure you didn't make a typo."),
        '',
      ].join('\n')
    )

    return false
  }

  if (await isStandaloneBinary()) {
    console.log(
      [
        '',
        chalk.bold.green('The plugin is ready to be used! 🔌'),
        '',
        `${chalk.bold('Note:')} All plugins are already baked into the standalone binary.`,
        '',
      ].join('\n')
    )

    return true
  }

  try {
    const module = await importPlugin(scope, command)

    console.log(
      [
        '',
        chalk.bold.green('The plugin is ready to be used! 🔌'),
        '',
        chalk.dim(`Contents: ${inspect(module, {colors: true})}`),
        '',
      ].join('\n')
    )
  } catch (error) {
    handleErrorGeneric(error, scope, command)

    if (isModuleNotFoundError(error)) {
      console.log(chalk.bold.red('Original NodeJS error:\n'), error)
    }

    return false
  }

  return true
}

const importPluginSubmodule = async (scope: string, command: string): Promise<PluginSubModule> => {
  if (await isStandaloneBinary()) {
    debug(`Loading plugin injected in the standalone binary`)

    // @ts-expect-error - All plugins are injected in the standalone binary with esbuild.
    return __INJECTED_PLUGIN_SUBMODULES__[scope][command]
  }

  // Use `FORCE_LOAD_BUNDLED_PLUGIN_COMMANDS=1` to force load bundled plugin commands in development mode
  if (process.execArgv.includes('--conditions=development') && !process.env.FORCE_LOAD_BUNDLED_PLUGIN_COMMANDS) {
    debug(`Loading development plugin command at ./packages/plugin-${scope}/src/commands/${command}.ts`)

    return (await import(`@datadog/datadog-ci-plugin-${scope}/commands/${command}`)) as PluginSubModule
  }

  // Load bundled plugin commands in production mode
  debug(`Loading bundled plugin command at ./packages/plugin-${scope}/dist/commands/${command}-bundled.js`)

  const bundled = (await import(`@datadog/datadog-ci-plugin-${scope}/commands/${command}-bundled`)) as {
    factory: (require: NodeJS.Require) => PluginSubModule
  }

  debug('Calling factory to get the plugin command')

  return bundled.factory(require)
}

const scopeToPackageName = (scope: string): string => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    return scope
  }

  return `@datadog/datadog-ci-plugin-${scope}`
}

const importPlugin = async (scope: string, command?: string): Promise<PluginPackageJson | PluginSubModule> => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    return extractPackageJson(await import(`${scope}/package.json`))
  }

  if (!command) {
    return extractPackageJson(await import(`@datadog/datadog-ci-plugin-${scope}/package.json`))
  }

  return importPluginSubmodule(scope, command)
}

const extractPackageJson = (content: unknown): PluginPackageJson => {
  if (typeof content !== 'object' || !content) {
    throw new Error('Invalid package.json: not an object')
  }

  if (!('name' in content) || typeof content.name !== 'string') {
    throw new Error('Invalid package.json: missing name')
  }

  if (!('version' in content) || typeof content.version !== 'string') {
    throw new Error('Invalid package.json: missing version')
  }

  const {name, version} = content

  return {name, version}
}

const handleErrorGeneric = (error: unknown, scope: string, command?: string) => {
  console.log()

  if (isModuleNotFoundError(error)) {
    const packageName = `@datadog/datadog-ci-plugin-${scope}`

    if (command) {
      messageBox('Plugin not installed 🔌', 'red', [
        `The ${chalk.cyan(`datadog-ci ${scope} ${command}`)} command could not be found.`,
        `To use this command, please install ${chalk.bold.magenta(packageName)} alongside datadog-ci.`,
      ])
    } else {
      messageBox('Plugin not installed 🔌', 'red', [
        `The ${chalk.bold.magenta(packageName)} package could not be found.`,
        `To use the any command in this plugin, please install it alongside datadog-ci.`,
      ])
    }

    console.log(
      [
        '',
        `For example, you can install it using:`,
        `  ${chalk.bold.cyan('npm install')} ${chalk.magenta(packageName)}`,
        `or`,
        `  ${chalk.bold.cyan('yarn add')} ${chalk.magenta(packageName)}`,
        '',
      ].join('\n')
    )

    return
  }

  console.error(chalk.bold.red('Unexpected error when executing plugin:'), error)
  console.log()
}

const isModuleNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
}
