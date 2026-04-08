import {readFile, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const PACKAGEURL_STRINGS_PATH = path.join(REPO_ROOT, 'node_modules', 'packageurl-js', 'src', 'strings.js')
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

export const createVirtualModulesPlugin = (modules) => ({
  name: 'datadog-virtual-modules',
  resolveId: (source) => {
    if (source in modules) {
      return `\0${source}`
    }
  },
  load: (id) => {
    if (id.startsWith('\0')) {
      return modules[id.slice(1)]
    }
  },
})

export const createPackageUrlLocaleComparePlugin = () => ({
  name: 'datadog-packageurl-locale-compare',
  transform: (code, id) => {
    if (normalizePath(id) !== normalizePath(PACKAGEURL_STRINGS_PATH)) {
      return undefined
    }

    return {
      code: code.replace(
        'const { compare: localeCompare } = new Intl.Collator()',
        'const localeCompare = (a, b) => String(a).localeCompare(b)'
      ),
      map: undefined,
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
      const commandPath = path.join(REPO_ROOT, 'packages', `plugin-${scope}`, 'dist', 'commands', `${command}.js`)
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

export const createCliRuntimePlugins = ({pluginCommandsByScope}) => {
  const virtualModuleId = 'virtual:datadog-ci-plugin-submodules'
  const cliEntryPath = normalizePath(path.join(REPO_ROOT, 'packages', 'datadog-ci', 'dist', 'cli.js'))
  const basePluginHelperPath = normalizePath(path.join(REPO_ROOT, 'packages', 'base', 'dist', 'helpers', 'plugin.js'))

  return [
    createVirtualModulesPlugin({
      [virtualModuleId]: buildInjectedPluginSubmodulesSource(pluginCommandsByScope),
    }),
    {
      name: 'datadog-cli-runtime-injection',
      transform: (code, id) => {
        const normalizedId = normalizePath(id)

        if (normalizedId === basePluginHelperPath) {
          return {
            code:
              `const __getInjectedPlugins = () => require(${JSON.stringify(virtualModuleId)});\n` + code,
            map: undefined,
          }
        }

        if (normalizedId !== cliEntryPath) {
          return undefined
        }

        const strippedCode = code.startsWith('#!') ? code.slice(code.indexOf('\n') + 1) : code
        const injectedLines = [
          `const __getInjectedPlugins = () => require(${JSON.stringify(virtualModuleId)});`,
        ]

        return {
          code: `${injectedLines.join('\n')}\n${strippedCode}`,
          map: undefined,
        }
      },
    },
    createPackageUrlLocaleComparePlugin(),
  ]
}

export const createMainModuleBanner = () =>
  [
    `#!/usr/bin/env node`,
    `import {fileURLToPath} from 'node:url';`,
    `import {realpathSync} from 'node:fs';`,
    `const __IS_MAIN_MODULE__ = !!process.argv[1] && (() => {`,
    `  try {`,
    `    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);`,
    `  } catch {`,
    `    return false;`,
    `  }`,
    `})();`,
  ].join('\n')

export const createOutExtensions = (jsExtension) => () => ({js: jsExtension})

export const createOutputOptions = () => ({
  comments: {
    legal: false,
  },
})

export const getBundledDependencyNames = (bundles) =>
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
