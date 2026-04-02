import chalk from 'chalk'
import {build} from 'tsdown'

import {allPluginCommands} from '../packages/datadog-ci/shims/plugin-commands.mjs'

import {
  REPO_ROOT,
  createPluginInjections,
  createOutExtensions,
  createOutputOptions,
  formatBundleSizeMb,
  summarizeBundle,
  writeLegalFiles,
} from './tsdown-shared.mjs'

const {cliVersion} = await import('@datadog/datadog-ci-base/version')

const packageDir = `${REPO_ROOT}/packages/datadog-ci`
const outputPath = `${packageDir}/dist/bundle.js`

try {
  const bundles = await build({
    cwd: packageDir,
    entry: {
      bundle: `${packageDir}/dist/cli.js`,
    },
    banner: {
      js: `// STANDALONE_BINARY_VERSION=${cliVersion}`,
    },
    outDir: `${packageDir}/dist`,
    format: ['cjs'],
    target: 'node22',
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
      pluginCommandsByScope: allPluginCommands,
    }),
  })

  await writeLegalFiles([outputPath], bundles)

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green('Build completed successfully'))
  console.log('Bundled dependencies:', summary.bundledDependencies.length)
  console.log(`Bundle size: ${chalk.bold(formatBundleSizeMb(summary.totalBytes))} MB`)
} catch (error) {
  console.error(chalk.red('Build failed:'), error)
  process.exit(1)
}
