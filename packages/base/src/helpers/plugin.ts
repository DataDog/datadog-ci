import {inspect} from 'node:util'

import chalk from 'chalk'
import {Command, CommandClass} from 'clipanion'
import createDebug from 'debug'

import {peerDependencies} from '@datadog/datadog-ci-base/package.json'

import {CommandContext} from '..'

import {isStandaloneBinary} from './is-standalone-binary'
import {messageBox} from './message-box'

export type PluginPackageJson = {name: string; version: string}
export type PluginSubModule = {PluginCommand: CommandClass<CommandContext>}

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

    console.log(
      [
        `To troubleshoot, run:`,
        `  ${chalk.bold.cyan(`datadog-ci plugin check`)} ${chalk.magenta(scope)}`,
        ...(command
          ? [`or`, `  ${chalk.bold.cyan(`datadog-ci plugin check`)} ${chalk.magenta(scope)} ${chalk.magenta(command)}`]
          : []),
        '',
      ].join('\n')
    )

    return 1
  }
}

export const listAllPlugins = (): string[] => {
  return Object.keys(peerDependencies)
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
      console.log(chalk.bold.red('Original Node.js error:\n'), error)
    }

    return false
  }

  return true
}

export const installPlugin = async (packageOrScope: string): Promise<boolean> => {
  const pluginName = scopeToPackageName(packageOrScope)
  const version = peerDependencies[pluginName as keyof typeof peerDependencies]
  const basePackage = `@datadog/datadog-ci-base@${version}`
  const pluginPackage = `${pluginName}@${version}`

  // We need to install the base package as well in order to satisfy the plugin's peerDependencies.
  const {installPackage} = await import('@antfu/install-pkg')
  const output = await installPackage([basePackage, pluginPackage], {
    silent: true,
    dev: true,
  })

  if (output.exitCode === 0) {
    console.log()
    messageBox('Installed plugin 🔌', 'green', [`Successfully installed ${chalk.bold(pluginPackage)}`])
    console.log()

    return true
  } else {
    console.log(chalk.bold.red(`Failed to install ${pluginPackage}! 🔌`))
    console.log('Stdout:', output.stdout)
    console.log('Stderr:', output.stderr)

    return false
  }
}

const handlePluginAutoInstall = async (scope: string) => {
  if (!!process.env['DISABLE_PLUGIN_AUTO_INSTALL']) {
    debug('Found DISABLE_PLUGIN_AUTO_INSTALL env variable, skipping auto-install')

    return
  }

  try {
    await importPlugin(scope)

    debug('Auto-install check: plugin is installed, skipping installation')
  } catch (error) {
    if (!isModuleNotFoundError(error)) {
      throw error
    }

    const pluginName = scopeToPackageName(scope)
    console.log(chalk.red(`Could not find ${chalk.bold(pluginName)}. Installing...`))
    await installPlugin(pluginName)
  }
}

const handleSimulateMissingPlugin = () => {
  if (!!process.env['SIMULATE_MISSING_PLUGIN']) {
    const error: NodeJS.ErrnoException = new Error('Simulated "Module not found" error')
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
}

const importPluginSubmodule = async (scope: string, command: string): Promise<PluginSubModule> => {
  if (await isStandaloneBinary()) {
    debug(`Loading plugin injected in the standalone binary`)

    // @ts-expect-error - All plugins are injected in the standalone binary with esbuild.
    return __INJECTED_PLUGIN_SUBMODULES__[scope][command]
  }

  await handlePluginAutoInstall(scope)

  debug(`Loading plugin command at ./packages/plugin-${scope}/dist/commands/${command}.js`)

  // Only handle `SIMULATE_MISSING_PLUGIN` when used in combination with `DISABLE_PLUGIN_AUTO_INSTALL`.
  if (process.env['DISABLE_PLUGIN_AUTO_INSTALL']) {
    handleSimulateMissingPlugin()
  }

  return (await import(`@datadog/datadog-ci-plugin-${scope}/commands/${command}`)) as PluginSubModule
}

const scopeToPackageName = (scope: string): string => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    return scope
  }

  return `@datadog/datadog-ci-plugin-${scope}`
}

const importPlugin = async (scope: string, command?: string): Promise<PluginPackageJson | PluginSubModule> => {
  handleSimulateMissingPlugin()

  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    // Use `require()` instead of `await import()` to avoid a `ERR_IMPORT_ATTRIBUTE_MISSING` error.
    return extractPackageJson(require(`${scope}/package.json`))
  }

  if (!command) {
    // Use `require()` instead of `await import()` to avoid a `ERR_IMPORT_ATTRIBUTE_MISSING` error.
    return extractPackageJson(require(`@datadog/datadog-ci-plugin-${scope}/package.json`))
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
  debug('Original error:', error)

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
        `You can install the plugin using:`,
        `  ${chalk.bold.cyan('datadog-ci plugin install')} ${chalk.magenta(scope)}`,
        `or`,
        `  ${chalk.bold.cyan('datadog-ci plugin install')} ${chalk.magenta(packageName)}`,
        '',
      ].join('\n')
    )

    return
  }

  console.log()
}

const isModuleNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return (
    error instanceof Error &&
    ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '')
  )
}
