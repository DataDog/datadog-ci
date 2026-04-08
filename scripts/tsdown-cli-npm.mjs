import {unlink, writeFile} from 'node:fs/promises'
import path from 'node:path'

import chalk from 'chalk'
import {build} from 'tsdown'

import {builtinPluginCommands} from '../packages/datadog-ci/shims/plugin-commands.mjs'

import {
  REPO_ROOT,
  createCliRuntimePlugins,
  createMainModuleBanner,
  createOutExtensions,
  createOutputOptions,
  summarizeBundle,
  writeLegalFiles,
} from './tsdown-shared.mjs'

const packageDir = `${REPO_ROOT}/packages/datadog-ci`
const outputPath = `${packageDir}/dist/bundle.mjs`
const temporaryEntryPath = path.join(packageDir, 'dist', '.bundle-entry.mjs')

try {
  await writeFile(
    temporaryEntryPath,
    [
      `import cliModule from './cli.js'`,
      `export const {gitMetadata, utils, version, BETA_COMMANDS, cli} = cliModule`,
      `export default cliModule`,
      '',
    ].join('\n')
  )

  const bundles = await build({
    cwd: packageDir,
    entry: {
      bundle: temporaryEntryPath,
    },
    outDir: `${packageDir}/dist`,
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: false,
    sourcemap: true,
    banner: {
      js: createMainModuleBanner(),
    },
    outExtensions: createOutExtensions('.mjs'),
    outputOptions: createOutputOptions(),
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: ['cpu-features'],
      onlyBundle: false,
    },
    plugins: createCliRuntimePlugins({
      pluginCommandsByScope: builtinPluginCommands,
    }),
  })

  await writeLegalFiles([outputPath], bundles)

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green('npm bundle completed successfully'))
  console.log('Bundled dependencies:', summary.bundledDependencies.length)
  console.log(`Bundle size: ${chalk.bold((summary.totalBytes / 1024 / 1024).toFixed(2))} MB`)
} catch (error) {
  console.error(chalk.red('npm bundle failed:'), error)
  process.exit(1)
} finally {
  try {
    await unlink(temporaryEntryPath)
  } catch {
    // The wrapper may not exist if the build failed before it was written.
  }
}
