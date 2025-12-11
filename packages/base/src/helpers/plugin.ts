import {exec} from 'node:child_process'
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
  const {basePackage, pluginPackage} = getPackagesToInstall(scope)

  const emitPath = process.platform === 'win32' ? 'set PATH' : 'printenv PATH'
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

  const isWindows = process.platform === 'win32'
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
    `Successfully installed ${chalk.bold(pluginPackage)} into ${chalk.dim(nodeModulesPath)}`,
    '',
    `To skip this step in the future, run ${chalk.bold.cyan('datadog-ci plugin install')} ${chalk.magenta(scope)} in your project.`,
  ])
  console.log()

  // Make the plugin resolvable.
  patchModulePaths(nodeModulesPath)
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

  // Add current working directory's `node_modules` to the module resolution paths
  // in case the command is running in NPX.
  patchModulePaths()

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

const NPX_PATH_REGEX = /\.npm\/_npx\//
const NPX_PATH_WIN_REGEX = /\\npm[-\\]+cache\\_npx\\/

/**
 * Find where NPX just installed the package.
 *
 * https://github.com/geelen/npx-import/blob/8a1e17ca4f88981b11be5090e20871f8704166b8/src/index.ts#L221-L250
 */
export const getTempPath = (stdout: string, isWindows: boolean): string => {
  if (isWindows) {
    const paths = stdout
      .replace(/^PATH=/i, '')
      .replace(/\\r\\n/g, ';')
      .split(';')
    const tempPath = paths.find((p) => NPX_PATH_WIN_REGEX.exec(p))

    if (!tempPath) {
      const list = paths.map((p) => ` - ${p}`).join('\n')
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '\\npm-cache\\_npx\\' in:\n${list}`
      )
    }

    return tempPath
  } else {
    const paths = stdout.split(':')
    const tempPath = paths.find((p) => NPX_PATH_REGEX.exec(p))

    if (!tempPath) {
      const list = paths.map((p) => ` - ${p}`).join('\n')
      throw new Error(
        `Failed to find temporary install directory. Looking for paths matching '/.npm/_npx/' in:\n${list}`
      )
    }

    return tempPath
  }
}
