import chalk from 'chalk'
import {build} from 'tsdown'

import {allPluginCommands} from '../packages/datadog-ci/shims/plugin-commands.mjs'

import {
  REPO_ROOT,
  createCliRuntimePlugins,
  createOutExtensions,
  createOutputOptions,
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
    outDir: `${packageDir}/dist`,
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    clean: false,
    sourcemap: true,
    banner: {
      js: `// STANDALONE_BINARY_VERSION=${cliVersion}`,
    },
    outExtensions: createOutExtensions('.js'),
    outputOptions: (options) => ({
      ...options,
      ...createOutputOptions(),
      comments: {
        ...options.comments,
        legal: false,
      },
      codeSplitting: false,
    }),
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: ['cpu-features'],
      onlyBundle: false,
    },
    plugins: createCliRuntimePlugins({
      pluginCommandsByScope: allPluginCommands,
      includeMainModuleCheck: false,
    }),
  })

  await writeLegalFiles([outputPath], bundles)

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green('Build completed successfully'))
  console.log('Bundled dependencies:', summary.bundledDependencies.length)
  console.log(`Bundle size: ${chalk.bold((summary.totalBytes / 1024 / 1024).toFixed(2))} MB`)
} catch (error) {
  console.error(chalk.red('Build failed:'), error)
  process.exit(1)
}
