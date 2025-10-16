import {exec} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {inspect} from 'node:util'

import chalk from 'chalk'
import {Command, CommandClass} from 'clipanion'
import createDebug from 'debug'

import {peerDependencies} from '@datadog/datadog-ci-base/package.json'

import {CommandContext} from '..'
import {cliVersion} from '../version'

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
  if (!isValidScope(scope)) {
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

/**
 * Installs a plugin and the base package as `devDependencies` in the current project with the right package manager.
 */
export const installPlugin = async (packageOrScope: string): Promise<boolean> => {
  const {basePackage, pluginPackage} = getPackagesToInstall(packageOrScope)

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

const temporarilyInstallPluginWithNpx = async (scope: string) => {
  const {basePackage, pluginPackage} = getPackagesToInstall(scope)

  const emitPath = os.platform() === 'win32' ? 'set PATH' : 'printenv PATH'
  const cmd = `npx -y -p ${basePackage} -p ${pluginPackage} ${emitPath}`

  debug('Using npx to install the missing plugin:', cmd)
  const output = await new Promise<string>((resolve, reject) => {
    exec(cmd, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
  debug('Output:', output)

  const tempPath = getTempPath(output)

  // Expecting the path ends with node_modules/.bin
  const nodeModulesPath = path.resolve(tempPath, '..')
  if (!nodeModulesPath.endsWith('node_modules')) {
    throw new Error(
      `Found NPX temporary path of '${tempPath}' but expected to be able to find a 'node_modules' directory by looking in '..'.`
    )
  }

  const installInstructions = isNpx()
    ? undefined
    : `\nTo skip this step in the future, run ${chalk.bold.cyan('datadog-ci plugin install')} ${chalk.magenta(scope)}`

  console.log()
  messageBox('Installed plugin 🔌', 'green', [
    `Successfully installed ${chalk.bold(pluginPackage)} into ${chalk.dim(nodeModulesPath)}`,
    ...(installInstructions ? [installInstructions] : []),
  ])
  console.log()

  // Add the temporary npx `node_modules` path to make the plugin resolvable.
  process.env['NODE_PATH'] = [process.env['NODE_PATH'], nodeModulesPath].filter(Boolean).join(path.delimiter)
  require('module').Module._initPaths()
  debug('NODE_PATH set to:', process.env['NODE_PATH'])
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
    await temporarilyInstallPluginWithNpx(pluginName)
  }
}

const importPluginSubmodule = async (scope: string, command: string): Promise<PluginSubModule> => {
  if (!isValidScope(scope)) {
    throw new Error(`Invalid scope: ${scope}`)
  }

  if (await isStandaloneBinary()) {
    debug(`Loading plugin injected in the standalone binary`)

    // @ts-expect-error - All plugins are injected in the standalone binary with esbuild.
    return __INJECTED_PLUGIN_SUBMODULES__[scope][command]
  }

  await handlePluginAutoInstall(scope)

  const submoduleName = `@datadog/datadog-ci-plugin-${scope}/commands/${command}`
  debug('Resolving submodule:', submoduleName)
  let resolvedPath = submoduleName
  try {
    resolvedPath = require.resolve(submoduleName)
    debug(`Resolved to: ${resolvedPath}`)
  } catch (error) {
    debug(`Could not require.resolve() the ${submoduleName} submodule: ${error}`)
  }
  debug('Importing submodule:', resolvedPath)

  return (await import(resolvedPath)) as PluginSubModule
}

const scopeToPackageName = (scope: string): string => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    return scope
  }

  return `@datadog/datadog-ci-plugin-${scope}`
}

const isValidScope = (scope: string): boolean => {
  return scopeToPackageName(scope) in peerDependencies
}

const getPackagesToInstall = (scope: string) => {
  const pluginName = scopeToPackageName(scope)
  const versionOverride = process.env['PLUGIN_AUTO_INSTALL_VERSION_OVERRIDE']
  const basePackage = `@datadog/datadog-ci-base@${versionOverride ?? cliVersion}`
  const pluginPackage = `${pluginName}@${versionOverride ?? cliVersion}`

  return {basePackage, pluginPackage}
}

const importPlugin = async (scope: string, command?: string): Promise<PluginPackageJson | PluginSubModule> => {
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

const NPX_PATH_REGEX = /\.npm\/_npx\//
const NPX_PATH_WIN_REGEX = /\\npm[-\\]+cache\\_npx\\/ // https://github.com/geelen/npx-import/commit/62106d18ebeddaa12b677e98339ae2f175ae42f2

/**
 * Find where NPX just installed the package.
 *
 * https://github.com/geelen/npx-import/blob/8a1e17ca4f88981b11be5090e20871f8704166b8/src/index.ts#L221-L250
 */
const getTempPath = (stdout: string): string => {
  if (os.platform() === 'win32') {
    // https://github.com/geelen/npx-import/commit/1b565203cf94be4c3d577d7db7b7dfdddb722ca8
    const paths = stdout
      .replace(/^PATH=/i, '')
      .replace(/\\\\\\\\/g, '\\\\')
      .replace(/\\r\\n/g, ';')
      .split(';')
    const tempPath = paths.find((p) => /\\npm[-\\]+cache\\_npx\\/.exec(p))

    if (!tempPath) {
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '\\npm-cache\\_npx\\' in:\n${JSON.stringify(
          paths
        )}`
      )
    }

    return tempPath
  } else {
    const paths = stdout.split(':')
    const tempPath = paths.find((p) => /\/\.npm\/_npx\//.exec(p))

    if (!tempPath) {
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '/.npm/_npx/' in:\n${JSON.stringify(
          paths
        )}`
      )
    }

    return tempPath
  }
}

/**
 * Check if the current process was started in an NPX context, with a temporary `node_modules/.bin` folder.
 */
const isNpx = (): boolean => {
  const regex = os.platform() === 'win32' ? NPX_PATH_WIN_REGEX : NPX_PATH_REGEX

  return (process.env['PATH'] ?? '').split(path.delimiter).some((p) => regex.test(p))
}
