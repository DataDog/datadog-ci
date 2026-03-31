import {exec} from 'node:child_process'
import path from 'node:path'
import url from 'node:url'
import {inspect} from 'node:util'

import type {CommandContext} from '..'
import type {Command, CommandClass} from 'clipanion'

import chalk from 'chalk'
import createDebug from 'debug'

import {peerDependencies} from '@datadog/datadog-ci-base/package.json'

import {cliVersion} from '../version'

import {isStandaloneBinary} from './is-standalone-binary'
import {messageBox} from './message-box'
import {getTempPath} from './npx'

export type PackageInfo = {name: string; version: string; range: string}
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
    debug('Error in executePluginCommand:', error)

    if (isModuleNotFoundError(error)) {
      console.log()
      showPluginNotInstalledMessageBox(scope, command)
      showInstallPluginInstructions(scope)
      console.log()
    } else {
      console.log(chalk.bold.red('Unexpected error when executing the plugin command:\n'), error)
    }

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
    const module = command ? await importPluginSubmodule(scope, command) : await importPlugin(scope)

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
    debug('Error in checkPlugin:', error)

    if (isPnpModuleNotFoundError(error) && error.pnpCode === 'MISSING_PEER_DEPENDENCY') {
      // This error is verbose and gives a lot of information about the PnP error, so we log it as is.
      console.log(error)
      console.log()
      showPnpPeerDependencyErrorMessageBox(scope)
      showInstallPluginInstructions(scope)
      console.log()
    } else if (isModuleNotFoundError(error)) {
      console.log()
      showPluginNotInstalledMessageBox(scope, command)
      showInstallPluginInstructions(scope)
      console.log()
    } else {
      console.log(chalk.bold.red('Unexpected error when checking the plugin:\n'), error)
    }

    return false
  }

  return true
}

/**
 * Installs a plugin and the base package as `devDependencies` in the current project with the right package manager.
 */
export const installPlugin = async (packageOrScope: string): Promise<boolean> => {
  if (!isValidScope(packageOrScope)) {
    console.log(
      [
        '',
        chalk.bold.red("This plugin is not listed as a possible peer dependency. Make sure you didn't make a typo."),
        '',
      ].join('\n')
    )

    return false
  }

  const {basePackage, pluginPackage} = getPackagesToInstall(packageOrScope)

  // We need to install the base package as well in order to satisfy the plugin's peerDependencies.
  const {installPackage} = await importInstallPkg()
  const output = await installPackage([basePackage.range, pluginPackage.range], {
    silent: !debug.enabled,
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

interface InstallPackageOptions {
  silent: boolean
  dev: boolean
}

interface InstallPackageOutput {
  exitCode: number
  stdout: string
  stderr: string
}

type InstallPackageFn = (names: string[], options: InstallPackageOptions) => Promise<InstallPackageOutput>

// Wrapper function to be mocked in tests
export const importInstallPkg = async () => {
  return import('@antfu/install-pkg') as Promise<{installPackage: InstallPackageFn}>
}

const temporarilyInstallPluginWithNpx = async (scope: string) => {
  const isWindows = process.platform === 'win32'
  const {basePackage, pluginPackage} = getPackagesToInstall(scope)

  const emitPath = isWindows ? 'set PATH' : 'printenv PATH'
  const cmd = `npx --ignore-scripts -y -p ${basePackage.range} -p ${pluginPackage.range} ${emitPath}`

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

  const tempPath = getTempPath(output, isWindows)

  // The path should end with `node_modules/.bin`
  const nodeModulesPath = path.resolve(tempPath, '..')
  if (!nodeModulesPath.endsWith('node_modules')) {
    throw new Error(
      `Found NPX temporary path of '${tempPath}' but expected to be able to find a 'node_modules' directory by looking in '..'.`
    )
  }

  console.log()
  messageBox('Installed plugin 🔌', 'green', [
    `Successfully installed ${chalk.bold(pluginPackage.name)} into ${chalk.dim(nodeModulesPath)}`,
    '',
    `To avoid supply chain attacks, consider installing the plugin explicitly with ${chalk.bold.cyan('datadog-ci plugin install')} ${chalk.magenta(scope)}.`,
  ])
  console.log()

  // Make the plugin resolvable.
  patchModulePaths(nodeModulesPath)

  printPluginVersion(pluginPackage.name, pluginPackage.version)
}

const handlePluginAutoInstall = async (scope: string) => {
  if (!!process.env['DISABLE_PLUGIN_AUTO_INSTALL']) {
    debug('Found DISABLE_PLUGIN_AUTO_INSTALL env variable, skipping auto-install')

    return
  }

  try {
    const {name, version} = await importPlugin(scope)
    printPluginVersion(name, version)

    debug('Auto-install check: plugin is installed, skipping installation')
  } catch (error) {
    debug('Error in handlePluginAutoInstall:', error)

    if (!isModuleNotFoundError(error)) {
      // Re-throw unexpected errors.
      throw error
    }

    if (isPnpModuleNotFoundError(error) && error.pnpCode === 'MISSING_PEER_DEPENDENCY') {
      // Re-throw PnP errors.
      console.log(chalk.red(`The plugin auto-install feature is not supported with Yarn Plug'n'Play (PnP).`))
      throw error
    }

    const pluginName = scopeToPackageName(scope)
    console.log(chalk.yellowBright(`Could not find ${chalk.bold(pluginName)}. Installing...`))
    await temporarilyInstallPluginWithNpx(pluginName)
  }
}

const printPluginVersion = (pluginName: string, pluginVersion: string) => {
  console.log(chalk.dim(`${pluginName} v${pluginVersion}`))
  if (pluginVersion !== cliVersion) {
    console.log(
      chalk.yellow(
        `The plugin is not the same version as datadog-ci, which could lead to unexpected behavior. Consider syncing the plugin version with datadog-ci.`
      )
    )
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

  // Add current working directory's `node_modules` to the module resolution paths
  // in case the command is running in NPX.
  patchModulePaths()

  await handlePluginAutoInstall(scope)

  const submoduleName = `@datadog/datadog-ci-plugin-${scope}/commands/${command}`
  debug('Resolving submodule:', submoduleName)
  let submodulePath = submoduleName
  try {
    const resolvedPath = require.resolve(submoduleName)
    const absolutePath = url.pathToFileURL(resolvedPath).href
    submodulePath = absolutePath
  } catch (error) {
    debug(`Could not require.resolve() the ${submoduleName} submodule: ${error}`)
  }
  debug('Importing submodule:', submodulePath)

  return (await import(submodulePath)) as PluginSubModule
}

export const scopeToPackageName = (scope: string): string => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    return scope
  }

  return `@datadog/datadog-ci-plugin-${scope}`
}

const patchModulePaths = (preferredPath?: string) => {
  const workingDirNodeModules = path.join(process.cwd(), 'node_modules')

  process.env['NODE_PATH'] = [process.env['NODE_PATH'], workingDirNodeModules, preferredPath]
    .filter(Boolean)
    .join(path.delimiter)

  require('module').Module._initPaths()
  debug('Module resolution paths set to:', process.env['NODE_PATH'])
}

const isValidScope = (scope: string): boolean => {
  return scopeToPackageName(scope) in peerDependencies
}

/**
 * @example "1.2.3"
 * @example "file:./artifacts/@datadog-datadog-ci-base-20.tgz"
 */
export const VERSION_OVERRIDE_REGEX = /^(\d+\.\d+\.\d+|file:\.\/[a-zA-Z0-9.\-/@]+)$/

const getPackagesToInstall = (scope: string) => {
  const pluginName = scopeToPackageName(scope)

  // Useful for testing with different versions than the current CLI version.
  // This supports any format that the current package manager supports.
  const baseVersionOverride = process.env['PLUGIN_AUTO_INSTALL_BASE_VERSION_OVERRIDE']
  const pluginVersionOverride = process.env['PLUGIN_AUTO_INSTALL_PLUGIN_VERSION_OVERRIDE']

  if (baseVersionOverride && !VERSION_OVERRIDE_REGEX.test(baseVersionOverride)) {
    throw new Error(`Invalid PLUGIN_AUTO_INSTALL_BASE_VERSION_OVERRIDE value: ${baseVersionOverride}`)
  }

  if (pluginVersionOverride && !VERSION_OVERRIDE_REGEX.test(pluginVersionOverride)) {
    throw new Error(`Invalid PLUGIN_AUTO_INSTALL_PLUGIN_VERSION_OVERRIDE value: ${pluginVersionOverride}`)
  }

  const baseVersion = baseVersionOverride ?? cliVersion
  const pluginVersion = pluginVersionOverride ?? cliVersion

  const basePackage: PackageInfo = {
    name: '@datadog/datadog-ci-base',
    version: baseVersion,
    range: `@datadog/datadog-ci-base@${baseVersion}`,
  }
  const pluginPackage: PackageInfo = {
    name: pluginName,
    version: pluginVersion,
    range: `${pluginName}@${pluginVersion}`,
  }

  return {basePackage, pluginPackage}
}

const importPlugin = async (scope: string): Promise<PackageInfo> => {
  if (scope.match(/^@datadog\/datadog-ci-plugin-[a-z-]+$/)) {
    // Use `require()` instead of `await import()` to avoid `ERR_IMPORT_ATTRIBUTE_MISSING` due to missing `{with: {type: 'json'}}`.
    // This is only supported with `--module` set to `esnext`, `node16`, or `nodenext`.
    return extractPackageJson(require(`${scope}/package.json`))
  }

  // Use `require()` instead of `await import()` to avoid `ERR_IMPORT_ATTRIBUTE_MISSING` due to missing `{with: {type: 'json'}}`.
  // This is only supported with `--module` set to `esnext`, `node16`, or `nodenext`.
  return extractPackageJson(require(`@datadog/datadog-ci-plugin-${scope}/package.json`))
}

const extractPackageJson = (content: unknown): PackageInfo => {
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

  return {name, version, range: `${name}@${version}`}
}

const showPluginNotInstalledMessageBox = (scope: string, command?: string) => {
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
}

const showPnpPeerDependencyErrorMessageBox = (scope: string) => {
  const packageName = `@datadog/datadog-ci-plugin-${scope}`

  messageBox("Yarn Plug'n'Play (PnP) error 🔌", 'red', [
    `Yarn Plug'n'Play (PnP) detected that ${chalk.bold.magenta(packageName)} was not installed alongside datadog-ci.`,
  ])
}

const showInstallPluginInstructions = (scope: string) => {
  const packageName = `@datadog/datadog-ci-plugin-${scope}`

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
}

const isModuleNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  return (
    error instanceof Error &&
    ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '')
  )
}

// See: https://github.com/yarnpkg/berry/blob/571363e6d64044b85a1f8885491c7f3b84c09f4b/packages/yarnpkg-pnp/sources/loader/internalTools.ts#L15-L23
interface PnpModuleNotFoundError extends NodeJS.ErrnoException {
  pnpCode:
    | 'BUILTIN_NODE_RESOLUTION_FAILED'
    | 'MISSING_DEPENDENCY'
    | 'MISSING_PEER_DEPENDENCY'
    | 'QUALIFIED_PATH_RESOLUTION_FAILED'
    | 'UNDECLARED_DEPENDENCY'
}

const isPnpModuleNotFoundError = (error: unknown): error is PnpModuleNotFoundError => {
  return isModuleNotFoundError(error) && (error as PnpModuleNotFoundError).pnpCode !== undefined
}
