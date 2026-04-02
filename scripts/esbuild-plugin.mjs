import {readFile, readdir, access} from 'fs/promises'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import chalk from 'chalk'
import {build} from 'esbuild'

import {appendMissingLicensesPlugin} from './esbuild-shared.mjs'

const packageDir = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
const pluginName = packageJson.name

const srcCommandsDir = path.join(packageDir, 'src', 'commands')
const commandFiles = (await readdir(srcCommandsDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
const commands = commandFiles.map((f) => f.replace('.ts', ''))

console.log(`Bundling ${chalk.bold(pluginName)} with commands: ${commands.join(', ')}`)

let hasIndex
try {
  await access(path.join(packageDir, 'src', 'index.ts'))
  hasIndex = true
} catch {
  hasIndex = false
}

const virtualEntryLines = [
  ...(hasIndex ? [`Object.assign(exports, require('./index'));`] : []),
  ...commands.map((cmd) => `exports['${cmd}'] = require('./commands/${cmd}');`),
]

try {
  const result = await build({
    stdin: {
      contents: virtualEntryLines.join('\n'),
      resolveDir: path.join(packageDir, 'src'),
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: 'linked',
    sourcemap: true,
    metafile: true,
    preserveSymlinks: true,
    external: ['cpu-features'],
    plugins: [appendMissingLicensesPlugin()],
    outfile: path.join(packageDir, 'dist', 'bundle.js'),
  })

  console.log(chalk.bold.green(`  ${pluginName} bundle.js bundled successfully`))
  console.log(`  Bundled modules: ${Object.keys(result.metafile.inputs).length}`)

  const outputs = Object.values(result.metafile.outputs)
  const totalBytes = outputs.reduce((sum, o) => sum + o.bytes, 0)
  console.log(`  Bundle size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
} catch (error) {
  console.error(chalk.red(`Failed to bundle ${pluginName}:`), error)
  process.exit(1)
}
