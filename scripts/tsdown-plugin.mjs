import {access, mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import path from 'node:path'

import chalk from 'chalk'
// eslint-disable-next-line no-restricted-imports
import {glob} from 'glob'
import {build} from 'tsdown'

import {
  REPO_ROOT,
  createOutExtensions,
  createOutputOptions,
  isDevtoolsEnabled,
  formatBundleSizeMb,
  formatModuleSize,
  summarizeBundle,
  writeLegalFiles,
} from './tsdown-shared.mjs'

const packageDir = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
const pluginName = packageJson.name
const typesEntrypoint = packageJson.types ?? packageJson.typings
const rootMetaPath = path.join(REPO_ROOT, 'datadog-ci.meta.json')
const rootMeta = JSON.parse(await readFile(rootMetaPath, 'utf8'))
const bundleConfig = rootMeta.plugins?.[pluginName]?.bundle ?? {}
const extraBundlePatterns = Array.isArray(bundleConfig.extraBundlePatterns) ? bundleConfig.extraBundlePatterns : []
const srcDir = path.join(packageDir, 'src')

const srcCommandsDir = path.join(packageDir, 'src', 'commands')

const commandFiles = (await readdir(srcCommandsDir)).filter(
  (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')
)
const commands = commandFiles.map((fileName) => fileName.slice(0, -'.ts'.length))

// e.g. `src/functions/*.ts`
const extraBundleEntries = (
  await Promise.all(
    extraBundlePatterns.map(async (pattern) => {
      const filePaths = await glob(pattern, {cwd: packageDir, nodir: true})

      return filePaths
        .filter((filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.d.ts'))
        .sort()
        .map((filePath) => {
          const normalizedFilePath = path.normalize(filePath)
          const sourcePath = path.join(packageDir, normalizedFilePath)
          const relativeToSrc = path.relative(srcDir, sourcePath)

          if (relativeToSrc.startsWith('..')) {
            throw new Error(
              `extraBundlePatterns entry ${JSON.stringify(pattern)} must match files under src/, got ${JSON.stringify(filePath)}`
            )
          }

          return {
            sourcePath,
            outputName: relativeToSrc.slice(0, -'.ts'.length).replaceAll(path.sep, '/'),
          }
        })
    })
  )
).flat()

console.log(`Bundling ${chalk.bold(pluginName)} with commands: ${commands.join(', ')}`)

// Not all plugins have an `index.ts` file for library exports.
let hasIndex = false
try {
  await access(path.join(packageDir, 'src', 'index.ts'))
  hasIndex = true
} catch {
  hasIndex = false
}

const temporaryEntryPath = path.join(packageDir, 'dist', '.bundle-entry.ts')
const commandWrapperPaths = commands.map((command) => path.join(packageDir, 'dist', 'commands', `${command}.js`))
const toCommandImportName = (command) => `command_${command.replaceAll(/[^a-zA-Z0-9_$]+/g, '_')}`
const virtualEntryLines = [
  ...(hasIndex ? [`export * from '../src/index'`] : []),

  ...commands.map((command) => {
    const commandImportName = toCommandImportName(command)

    return `import {PluginCommand as ${commandImportName}} from ${JSON.stringify(`../src/commands/${command}`)}`
  }),
  '',
  `export const commands = {`,
  ...commands.map((command) => `  ${JSON.stringify(command)}: {PluginCommand: ${toCommandImportName(command)}},`),
  `}`,
]

try {
  await mkdir(path.join(packageDir, 'dist/commands'), {recursive: true})
  await writeFile(temporaryEntryPath, virtualEntryLines.join('\n'))

  const buildOptions = {
    cwd: packageDir,
    outDir: path.join(packageDir, 'dist'),
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    clean: false,
    sourcemap: true,
    devtools: isDevtoolsEnabled(),
    outExtensions: createOutExtensions('.js'),
    outputOptions: createOutputOptions(),
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: ['cpu-features'],
      onlyBundle: false,
    },
  }

  const mainBundles = await build({
    ...buildOptions,
    entry: {
      bundle: temporaryEntryPath,
    },
  })

  const extraBundles = []
  for (const {outputName, sourcePath} of extraBundleEntries) {
    const entryBundles = await build({
      ...buildOptions,
      outputOptions: createOutputOptions(),
      entry: {
        [outputName]: sourcePath,
      },
    })
    extraBundles.push(...entryBundles)
  }

  const outputPaths = [path.join(packageDir, 'dist', 'bundle.js')]
  outputPaths.push(...extraBundleEntries.map(({outputName}) => path.join(packageDir, 'dist', `${outputName}.js`)))

  await Promise.all(
    commandWrapperPaths.map((commandWrapperPath, index) =>
      writeFile(
        commandWrapperPath,
        `"use strict"\nmodule.exports = require("../bundle.js").commands["${commands[index]}"]\n`
      )
    )
  )

  await writeLegalFiles([outputPaths[0]], mainBundles)
  if (outputPaths.length > 1) {
    await writeLegalFiles(outputPaths.slice(1), extraBundles)
  }
  const bundles = [...mainBundles, ...extraBundles]
  const emittedArtifacts = new Set(
    bundles.flatMap((bundle) =>
      bundle.chunks
        .map((chunk) => path.join(chunk.outDir, chunk.fileName))
        .filter(
          (filePath) => filePath.endsWith('.js') || filePath.endsWith('.js.map') || filePath.endsWith('.js.LEGAL.txt')
        )
    )
  )
  emittedArtifacts.add(path.join(packageDir, 'dist', 'bundle.js.LEGAL.txt'))
  commandWrapperPaths.forEach((commandWrapperPath) => emittedArtifacts.add(commandWrapperPath))
  for (const outputPath of outputPaths.slice(1)) {
    emittedArtifacts.add(`${outputPath}.LEGAL.txt`)
  }
  if (typeof typesEntrypoint === 'string') {
    emittedArtifacts.add(path.resolve(packageDir, typesEntrypoint))
  }

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green(`  ${pluginName} bundle(s) completed successfully`))
  console.log(`  Bundled dependencies: ${summary.bundledDependencies.length}`)
  console.log(`  Bundle size: ${formatBundleSizeMb(summary.totalBytes)} MB`)
  console.log('  Top modules by size:')
  for (const {name, bytes} of summary.topModules) {
    console.log(`    ${name}: ${formatModuleSize(bytes)}`)
  }
} catch (error) {
  console.error(chalk.red(`Failed to bundle ${pluginName}:`), error)
  process.exit(1)
}
