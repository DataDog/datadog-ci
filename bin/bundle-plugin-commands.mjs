import {readdir, unlink} from 'fs/promises'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import chalk from 'chalk'
import {build} from 'esbuild'

const pluginPath = process.argv[2]

const commandsDir = path.join(pluginPath, './dist/commands')
const commandEntrypoints = []

console.log(`${chalk.bold.cyan('Reading commands directory:')} ${commandsDir}\n`)

try {
  const files = await readdir(commandsDir)
  commandEntrypoints.push(
    ...files
      .filter((file) => file.endsWith('.js') && !file.endsWith('-bundled.js'))
      .map((file) => path.join(commandsDir, file))
  )
} catch (err) {
  console.error(chalk.red(`Failed to read commands directory: ${commandsDir}`), err)
  process.exit(1)
}

if (commandEntrypoints.length === 0) {
  console.error(chalk.red(`${chalk.bold('No command entrypoints found')} in ${commandsDir}`))
  process.exit(1)
}

console.log(chalk.cyan(`Found ${chalk.bold(commandEntrypoints.length)} command entrypoints:`))
console.log(commandEntrypoints.map((entrypoint) => ` - ${chalk.magenta(entrypoint)}`).join('\n') + '\n')

const matchAll = /()/

/** @type {import('esbuild').Plugin} */
const dynamicLibResolver = {
  name: `dynamic-lib-resolver`,
  // eslint-disable-next-line prefer-arrow/prefer-arrow-functions, @typescript-eslint/no-shadow
  setup(build) {
    build.onResolve({filter: matchAll}, async (args) => {
      // Dynamic lib
      if (args.path.includes('@datadog/datadog-ci-base')) {
        return {
          path: args.path,
          external: true,
        }
      }

      return undefined
    })
  },
}

const bundlePluginCommand = async (entrypoint) => {
  try {
    await build({
      entryPoints: [entrypoint],
      banner: {
        js: `/* eslint-disable */
//prettier-ignore
module.exports = {
  factory: function (require) {`,
      },
      globalName: 'plugin',
      footer: {
        js: `
    return plugin;
  }
};`,
      },
      plugins: [dynamicLibResolver],
      bundle: true,
      platform: 'node',
      target: 'node18', // XXX: we could read `@datadog/datadog-ci` package's `engines.node` property
      format: 'iife',
      outfile: `${entrypoint.replace('.js', '')}-bundled.js`,
      external: ['cpu-features'],
      preserveSymlinks: true,
      minify: false, // Keep meaningful stack traces. We don't mind the size of the output.
      legalComments: 'none',
      // logLevel: 'debug',
    })

    // Success
    console.log(chalk.bold.green(`Build completed successfully for ${entrypoint}`))
  } catch (error) {
    console.error(chalk.red('Build failed:'), error)
    process.exit(1)
  }
}

const cleanEntrypoint = async (entrypoint) => {
  const baseName = entrypoint.replace(/\.js$/, '')
  const filesToRemove = [`${baseName}.js`, `${baseName}.d.ts`, `${baseName}.js.map`]
  for (const file of filesToRemove) {
    await unlink(file)
    console.log(chalk.green(`Removed ${file}`))
  }
}

for (const entrypoint of commandEntrypoints) {
  await bundlePluginCommand(entrypoint)
  await cleanEntrypoint(entrypoint)
  console.log()
}
