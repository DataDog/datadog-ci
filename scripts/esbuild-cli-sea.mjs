import {writeFile} from 'fs/promises'

import chalk from 'chalk'
import {build} from 'esbuild'

import {createBuildConfig} from './esbuild-shared.mjs'

const {cliVersion} = await import('@datadog/datadog-ci-base/version')

try {
  const result = await build(
    createBuildConfig({
      mode: 'sea',
      entryPoints: ['dist/cli.js'],
      outfile: 'dist/bundle.js',
      inject: [
        'shims/injected-plugin-submodules.js',
        'shims/intl-collator.js',
      ],
      banner: {
        js: `// STANDALONE_BINARY_VERSION=${cliVersion}`,
      },
    })
  )

  console.log(chalk.bold.green('Build completed successfully'))
  console.log('Bundled modules:', Object.keys(result.metafile.inputs).length)

  console.log()
  console.log(`Writing metafile to ${chalk.cyan('dist/meta.json')}`)
  console.log(`Use ${chalk.cyan('https://esbuild.github.io/analyze/')} to analyze the bundle.`)
  console.log()
  await writeFile('dist/meta.json', JSON.stringify(result.metafile, undefined, 2))

  const inputs = Object.keys(result.metafile.inputs)
  console.log(`Bundled files starting matching ${chalk.bold.magenta('@datadog/datadog-ci-plugin-*')}:`)
  console.log(inputs.filter((input) => input.includes('@datadog/datadog-ci-plugin-')))
} catch (error) {
  console.error(chalk.red('Build failed:'), error)
  process.exit(1)
}
