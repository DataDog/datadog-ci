import {execFileSync} from 'node:child_process'
import {readFile, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const LICENSE_FILENAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'License']

const normalizePath = (filePath) => filePath.replaceAll(path.sep, '/')

const readPackageLicense = async (packageName) => {
  let packageJsonPath
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`, {paths: [REPO_ROOT]})
  } catch {
    return undefined
  }

  const packageRoot = path.dirname(packageJsonPath)
  for (const filename of LICENSE_FILENAMES) {
    try {
      const content = await readFile(path.join(packageRoot, filename), 'utf8')

      return {
        label: `${packageName}/${filename}`,
        content,
      }
    } catch {
      // Try the next common filename.
    }
  }

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    if (packageJson.license) {
      return {
        label: `${packageName}/package.json`,
        content: `License: ${packageJson.license}`,
      }
    }
  } catch {
    // Fall back to skipping the package entry.
  }

  return undefined
}

const createVirtualModulesPlugin = (modules) => ({
  name: 'datadog-virtual-modules',
  resolveId: (source) => {
    if (source in modules) {
      // `\0` is the conventional "virtual module" prefix for Rollup-style plugins.
      // It marks this id as in-memory so the bundler doesn't try to resolve it on disk.
      return `\0${source}`
    }
  },
  load: (id) => {
    if (id.startsWith('\0')) {
      return modules[id.slice(1)]
    }
  },
})

const buildInjectedPluginSubmodulesSource = (pluginCommandsByScope) => {
  const lines = []
  const scopeEntries = []
  const packageJsonEntries = []
  let importIndex = 0

  for (const [scope, commands] of Object.entries(pluginCommandsByScope)) {
    const commandEntries = []
    const pluginPackageJson = require(path.join(REPO_ROOT, 'packages', `plugin-${scope}`, 'package.json'))
    for (const command of commands) {
      const variableName = `pluginCommand${importIndex++}`
      const commandPath = path.join(REPO_ROOT, 'packages', `plugin-${scope}`, 'src', 'commands', `${command}.ts`)
      lines.push(`const ${variableName} = require(${JSON.stringify(commandPath)});`)
      commandEntries.push(`${JSON.stringify(command)}: ${variableName}`)
    }

    scopeEntries.push(`${JSON.stringify(scope)}: {${commandEntries.join(', ')}}`)
    packageJsonEntries.push(
      `${JSON.stringify(scope)}: {name: ${JSON.stringify(pluginPackageJson.name)}, version: ${JSON.stringify(
        pluginPackageJson.version
      )}}`
    )
  }

  lines.push(`exports.injectedPluginSubmodules = {${scopeEntries.join(', ')}};`)
  lines.push(`exports.injectedPluginPackageJsons = {${packageJsonEntries.join(', ')}};`)

  return lines.join('\n')
}

export const createPluginInjections = ({pluginCommandsByScope}) => {
  const virtualModuleId = 'virtual:datadog-ci-injected-plugin'
  const pluginLoaderPath = normalizePath(path.join(REPO_ROOT, 'packages', 'base', 'dist', 'helpers', 'plugin.js'))

  return [
    createVirtualModulesPlugin({
      [virtualModuleId]: buildInjectedPluginSubmodulesSource(pluginCommandsByScope),
    }),
    {
      name: 'datadog-injected-plugin-loader',
      transform: (code, id) => {
        const normalizedId = normalizePath(id)
        const injectionLine = `const __getInjectedPlugins = () => require("${virtualModuleId}");`

        if (normalizedId === pluginLoaderPath) {
          return {code: `${injectionLine}\n${code}`, map: undefined}
        }

        return
      },
    },
  ]
}

// tsdown emits CJS, where `import.meta` is `{}`, so pac-proxy-agent's `import.meta.resolve('quickjs-wasi/quickjs.wasm')` throws once a PAC proxy is used.
// Inlining embeds the ~830 KB base64 WASM in every published tsdown bundle (CLI npm/SEA and each plugin's `dist/bundle.js`, since all bundle base),
// about +0.2 MB versus 5.27.0 because `@tootallnate/quickjs-emscripten` already embedded its WASM.
// The unbundled `@datadog/datadog-ci-base` is unaffected: Node resolves the `.wasm` from `node_modules`.
const QUICKJS_WASM_LOADER = "readFile(new URL(import.meta.resolve('quickjs-wasi/quickjs.wasm')))"

export const createQuickjsWasmInlining = () => ({
  name: 'datadog-inline-quickjs-wasm',
  transform: async (code, id) => {
    const normalizedId = normalizePath(id)
    if (!normalizedId.includes('/node_modules/pac-proxy-agent/') || !code.includes('quickjs-wasi/quickjs.wasm')) {
      return
    }

    if (!code.includes(QUICKJS_WASM_LOADER)) {
      throw new Error(`Unexpected QuickJS WASM loader in ${id}, please update \`createQuickjsWasmInlining()\``)
    }

    const wasmPath = createRequire(id).resolve('quickjs-wasi/quickjs.wasm')
    const wasmBase64 = (await readFile(wasmPath)).toString('base64')

    return {
      code: code.replace(QUICKJS_WASM_LOADER, `Promise.resolve(Buffer.from(${JSON.stringify(wasmBase64)}, 'base64'))`),
      map: undefined,
    }
  },
})

// Rolldown can emit duplicate declarations when deconflicting identifiers, so fail the build if a bundle does not parse.
export const assertBundlesParse = (outputPaths) => {
  for (const outputPath of outputPaths) {
    execFileSync(process.execPath, ['--check', outputPath], {stdio: 'inherit'})
  }
}

export const createOutExtensions = (jsExtension) => () => ({js: jsExtension})

export const createOutputOptions = () => ({
  codeSplitting: false,
  comments: {
    legal: false,
  },
})

export const formatBundleSizeMb = (totalBytes) => (totalBytes / 1024 / 1024).toFixed(2)

const getBundledDependencyNames = (bundles) =>
  [...new Set(bundles.flatMap((bundle) => [...bundle.inlinedDeps.keys()]))].sort((a, b) => a.localeCompare(b))

export const writeLegalFiles = async (outputPaths, bundles) => {
  const packageNames = getBundledDependencyNames(bundles)
  const sections = []

  for (const packageName of packageNames) {
    const license = await readPackageLicense(packageName)
    if (!license) {
      continue
    }

    sections.push(`\n${license.label}:\n  /*\n${license.content.trimEnd().replace(/^/gm, '   * ')}\n   */\n`)
  }

  const legalText = `Bundled license information:\n${sections.join('')}`

  await Promise.all(outputPaths.map((outputPath) => writeFile(`${outputPath}.LEGAL.txt`, legalText)))
}

export const summarizeBundle = (bundles) => {
  const totalBytes = bundles
    .flatMap((bundle) => bundle.chunks)
    .reduce((sum, chunk) => sum + ('code' in chunk ? chunk.code.length : String(chunk.source).length), 0)

  return {
    totalBytes,
    bundledDependencies: getBundledDependencyNames(bundles),
  }
}
