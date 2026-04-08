import {access, readFile, readdir, unlink, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

import chalk from 'chalk'
import {build} from 'tsdown'

import {
  REPO_ROOT,
  createOutExtensions,
  createOutputOptions,
  summarizeBundle,
  writeLegalFiles,
} from './tsdown-shared.mjs'

const packageDir = process.cwd()
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
const pluginName = packageJson.name
const rootMetaPath = path.join(REPO_ROOT, 'datadog-ci.meta.json')
const rootMeta = JSON.parse(await readFile(rootMetaPath, 'utf8'))
const bundleConfig = rootMeta.plugins?.[pluginName]?.bundle ?? {}
const standaloneEntryDirs = Array.isArray(bundleConfig.standaloneEntryDirs) ? bundleConfig.standaloneEntryDirs : []

const srcCommandsDir = path.join(packageDir, 'src', 'commands')

const commandFiles = (await readdir(srcCommandsDir)).filter(
  (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')
)
const commands = commandFiles.map((fileName) => fileName.slice(0, -'.ts'.length))

const standaloneEntrypointGroups = []
for (const dirName of standaloneEntryDirs) {
  const sourceDir = path.join(packageDir, 'src', dirName)
  try {
    const files = (await readdir(sourceDir)).filter(
      (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')
    )
    standaloneEntrypointGroups.push({
      dirName,
      fileNames: files,
    })
  } catch {
    standaloneEntrypointGroups.push({
      dirName,
      fileNames: [],
    })
  }
}

console.log(`Bundling ${chalk.bold(pluginName)} with commands: ${commands.join(', ')}`)

let hasIndex = false
try {
  await access(path.join(packageDir, 'src', 'index.ts'))
  hasIndex = true
} catch {
  hasIndex = false
}

const assertNoExportCollisions = async () => {
  if (!hasIndex) {
    return
  }

  const builtIndexPath = path.join(packageDir, 'dist', 'index.js')
  const indexExports = Object.keys(require(builtIndexPath))
  const collisions = commands.filter((command) => indexExports.includes(command))
  if (collisions.length > 0) {
    throw new Error(
      `Index exports conflict with command names in ${pluginName}: ${collisions.join(', ')}. Rename one of the exports or commands before bundling.`
    )
  }
}

const temporaryEntryPath = path.join(packageDir, 'dist', '.bundle-entry.js')
const commandWrapperPaths = commands.map((command) => path.join(packageDir, 'dist', 'commands', `${command}.js`))
const virtualEntryLines = [
  ...(hasIndex
    ? [`Object.assign(exports, require(${JSON.stringify(path.join(packageDir, 'dist', 'index.js'))}));`]
    : []),

  ...commands.map((command) => {
    const commandPath = path.join(packageDir, 'dist', 'commands', `${command}.js`)

    return `exports[${JSON.stringify(command)}] = require(${JSON.stringify(commandPath)});`
  }),
]

try {
  await assertNoExportCollisions()
  await writeFile(temporaryEntryPath, virtualEntryLines.join('\n'))

  const buildOptions = {
    cwd: packageDir,
    outDir: path.join(packageDir, 'dist'),
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    clean: false,
    sourcemap: true,
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
  }

  const mainBundles = await build({
    ...buildOptions,
    entry: {
      bundle: temporaryEntryPath,
    },
  })

  const standaloneBundles = []
  for (const {dirName, fileNames} of standaloneEntrypointGroups) {
    for (const fileName of fileNames) {
      const entryName = fileName.slice(0, -'.ts'.length)
      const entryOutputPath = path.join(packageDir, 'dist', dirName, `${entryName}.js`)
      const entryBundles = await build({
        ...buildOptions,
        outputOptions: (options) => ({
          ...options,
          ...createOutputOptions(),
          comments: {
            // Emit dependency license text into sibling `.LEGAL.txt` files via writeLegalFiles()
            // instead of duplicating legal comments inside every standalone bundle.
            ...options.comments,
            legal: false,
          },
          codeSplitting: false,
        }),
        entry: {
          [`${dirName}/${entryName}`]: entryOutputPath,
        },
      })
      standaloneBundles.push(...entryBundles)
    }
  }

  const outputPaths = [path.join(packageDir, 'dist', 'bundle.js')]
  outputPaths.push(
    ...standaloneEntrypointGroups.flatMap(({dirName, fileNames}) =>
      fileNames.map((fileName) => path.join(packageDir, 'dist', dirName, `${fileName.slice(0, -'.ts'.length)}.js`))
    )
  )

  await Promise.all(
    commandWrapperPaths.map((commandWrapperPath, index) =>
      writeFile(
        commandWrapperPath,
        `"use strict"\nmodule.exports = require("../bundle.js")[${JSON.stringify(commands[index])}]\n`
      )
    )
  )

  await writeLegalFiles([outputPaths[0]], mainBundles)
  if (outputPaths.length > 1) {
    await writeLegalFiles(outputPaths.slice(1), standaloneBundles)
  }
  const bundles = [...mainBundles, ...standaloneBundles]
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

  const removeUnbundledArtifacts = async (dir) => {
    const dirEntries = await readdir(dir, {withFileTypes: true})
    for (const dirEntry of dirEntries) {
      const absolutePath = path.join(dir, dirEntry.name)
      if (dirEntry.isDirectory()) {
        await removeUnbundledArtifacts(absolutePath)
        continue
      }

      if (
        (absolutePath.endsWith('.js') || absolutePath.endsWith('.js.map') || absolutePath.endsWith('.js.LEGAL.txt')) &&
        !emittedArtifacts.has(absolutePath)
      ) {
        await unlink(absolutePath)
      }
    }
  }

  await removeUnbundledArtifacts(path.join(packageDir, 'dist'))
  try {
    await unlink(temporaryEntryPath)
  } catch {
    // The cleanup step may already have removed the temporary entry file.
  }

  const summary = summarizeBundle(bundles)
  console.log(chalk.bold.green(`  ${pluginName} bundle(s) completed successfully`))
  console.log(`  Bundled dependencies: ${summary.bundledDependencies.length}`)
  console.log(`  Bundle size: ${(summary.totalBytes / 1024 / 1024).toFixed(2)} MB`)
} catch (error) {
  try {
    await unlink(temporaryEntryPath)
  } catch {
    // The temporary entry might not exist if the build failed early.
  }

  console.error(chalk.red(`Failed to bundle ${pluginName}:`), error)
  process.exit(1)
}
