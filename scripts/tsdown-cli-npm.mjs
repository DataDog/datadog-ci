import chalk from 'chalk'
import {build} from 'tsdown'

import {builtinPluginCommands} from '../packages/datadog-ci/shims/plugin-commands.mjs'

import {
  REPO_ROOT,
  createPluginInjections,
  createOutExtensions,
  createOutputOptions,
  formatBundleSizeMb,
  summarizeBundle,
  writeLegalFiles,
} from './tsdown-shared.mjs'

const packageDir = `${REPO_ROOT}/packages/datadog-ci`
const cliEntryPath = `${packageDir}/src/cli.ts`
const outputPath = `${packageDir}/dist/bundle.js`

try {
  const bundles = await build({
    cwd: packageDir,
    entry: {
      bundle: cliEntryPath,
    },
    outDir: `${packageDir}/dist`,
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    clean: false,
    sourcemap: true,
    outExtensions: createOutExtensions('.js'),
    outputOptions: createOutputOptions(),
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: ['cpu-features'],
      onlyBundle: false,
    },
    plugins: createPluginInjections({
      pluginCommandsByScope: builtinPluginCommands,
    }),
  })

  await writeLegalFiles([outputPath], bundles)

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green('NPM bundle completed successfully'))
  console.log('Bundled dependencies:', summary.bundledDependencies.length)
  console.log(`Bundle size: ${chalk.bold(formatBundleSizeMb(summary.totalBytes))} MB`)
} catch (error) {
  console.error(chalk.red('NPM bundle failed:'), error)
  process.exit(1)
}
