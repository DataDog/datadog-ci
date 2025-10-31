import {execSync} from 'child_process'
import fs from 'fs'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import chalk from 'chalk'
import {diff} from 'jest-diff'

// Source of truth for command scopes without plugins: this should be updated manually.
const noPluginExceptions = new Set(['git-metadata', 'plugin', 'tag'])
// Source of truth for scope-less commands: this should be updated manually.
const scopeLessCommandExceptions = new Set(['tag'])
// Scopes that have an associated GitHub Action that doesn't pin the version of @datadog/datadog-ci.
// https://github.com/DataDog/synthetics-ci-github-action is not included because it does pin a version.
const scopesWithUnpinnedDatadogCiInGithubAction = {
  // Strictly unpinned
  coverage: 'https://github.com/DataDog/coverage-upload-github-action',
  junit: 'https://github.com/DataDog/junit-upload-github-action',
  // Only pins the major version
  sarif: 'https://github.com/DataDog/datadog-static-analyzer-github-action',
  sbom: 'https://github.com/DataDog/datadog-static-analyzer-github-action',
}

type Package = {
  folder: string
  packageJson: {
    name: string
    version: string
    dependencies: Record<string, string>
    peerDependencies: Record<string, string>
  }
}

type CommandScope = {
  scope: string
  commands: string[]
}

type PluginPackage = Package & CommandScope

const fix = process.argv.includes('--fix')
const isCI = !!process.env.CI

const camelCase = (str: string) => str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

const upperCamelCase = (str: string) => {
  const camel = camelCase(str)

  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

const exec = (cmd: string, {throwError}: {throwError?: boolean} = {}) => {
  console.log(chalk.bold.blue(`\nRunning ${cmd}...`))
  try {
    execSync(cmd, {stdio: 'inherit'})
  } catch (e) {
    if (throwError) {
      throw e
    }
  }
}

const loadPackage = (folderName: string): Package => {
  const folder = path.join('packages', folderName)
  const packageJson = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'))

  return {
    folder,
    packageJson: {
      name: packageJson.name as string,
      version: packageJson.version as string,
      dependencies: packageJson.dependencies as Record<string, string>,
      peerDependencies: packageJson.peerDependencies as Record<string, string>,
    },
  }
}

const findCommands = (folder: string, scope: string): string[] => {
  if (noPluginExceptions.has(scope)) {
    return fs
      .readdirSync(folder) // `packages/base/src/commands/<scope>`
      .reduce<string[]>((acc, file) => {
        if (!file.endsWith('.ts')) {
          return acc
        }

        const content = fs.readFileSync(path.join(folder, file), 'utf8')
        if (!content.match(/export class \w+ extends BaseCommand/)) {
          return acc
        }

        return [...acc, file.replace('.ts', '')]
      }, [])
  }

  try {
    return fs
      .readdirSync(path.join(folder, 'src/commands')) // `packages/plugin-<scope>/src/commands`
      .reduce<string[]>((acc, file) => (file.endsWith('.ts') ? [...acc, file.replace('.ts', '')] : acc), [])
  } catch (e) {
    if (e instanceof Error && e.message.includes('no such file or directory')) {
      const alternateFile = path.join('packages/base/src/commands', scope, 'cli.ts')
      console.log(chalk.yellow(`Could not find commands in ${chalk.bold(folder)}, this means it's being migrated...`))
      console.log(chalk.yellow(`Reading imports in ${chalk.bold(alternateFile)} instead.\n`))

      const content = fs.readFileSync(alternateFile, 'utf8')

      return [...content.matchAll(/import \{\w+Command\} from '.\/(?<command>\w+)'/g)].reduce(
        (acc, result) => (result.groups?.command ? [...acc, result.groups.command] : acc),
        [] as string[]
      )
    }
    throw e
  }
}

const formatCodeownersFile = () => {
  const file = '.github/CODEOWNERS'
  const originalContent = fs.readFileSync(file, 'utf8')

  const lines = originalContent.split('\n')
  const formattedLines: string[] = []

  let currentBlockPadding: number | undefined
  for (const line of lines) {
    const match = line.match(/^(?<pattern>[\w/.*-]+?)(?<spacing>[ ]{1,})(?<owners>[@\w/ -]+)/d)
    if (!match || !match.indices?.groups) {
      currentBlockPadding = undefined
      formattedLines.push(line)
      continue
    }

    const {pattern, owners} = match.groups ?? {}
    const ownersStart = match.indices.groups.owners[0]

    if (currentBlockPadding === undefined) {
      currentBlockPadding = ownersStart
    }

    formattedLines.push(`${pattern.padEnd(currentBlockPadding)}${owners}`)
  }

  const newContent = formattedLines.join('\n')

  return makeApplyChanges(file, originalContent, newContent)
}

const formatBasePackageCliFile = () => {
  const file = `packages/base/src/cli.ts`
  const originalContent = fs.readFileSync(file, 'utf8')

  const imports = [
    ...pluginPackages.map((p) => ({
      importName: `${camelCase(p.scope)}Commands`,
      importPath: `./commands/${p.scope}/cli`,
      scope: p.scope,
    })),
    ...Array.from(noPluginExceptions).map((exceptionScope) => ({
      importName: `${camelCase(exceptionScope)}Commands`,
      importPath: `./commands/${exceptionScope}/cli`,
      scope: exceptionScope,
    })),
  ].sort((a, b) => a.importPath.localeCompare(b.importPath))

  const newContent = `/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

${imports.map((p) => `import {commands as ${p.importName}} from '${p.importPath}'`).join('\n')}

// prettier-ignore
export const commands = {
${imports.map((p) => `  '${p.scope}': ${p.importName},`).join('\n')}
} satisfies RecordWithKebabCaseKeys

/**
 * Some command scopes do not have a plugin package, and their logic is entirely included in \`@datadog/datadog-ci-base\`.
 */
export const noPluginExceptions: Set<string> = new Set([${Array.from(noPluginExceptions)
    .map((e) => `'${e}'`)
    .join(', ')}]) satisfies Set<
  keyof typeof commands
>
`

  return makeApplyChanges(file, originalContent, newContent)
}

const formatBasePackageScopeCliFile = ({scope, commands}: CommandScope) => {
  const file = `packages/base/src/commands/${scope}/cli.ts`
  const originalContent = fs.readFileSync(file, 'utf8')

  const imports = commands.map((command) => ({
    importName: scopeLessCommandExceptions.has(scope)
      ? `${upperCamelCase(command)}Command`
      : `${upperCamelCase(scope)}${upperCamelCase(command)}Command`,
    importPath: `./${command}`,
  }))

  const newContent = `/* eslint-disable import-x/order */
${imports.map((i) => `import {${i.importName}} from '${i.importPath}'`).join('\n')}

// prettier-ignore
export const commands = [
${imports.map((i) => `  ${i.importName},`).join('\n')}
]
`

  return makeApplyChanges(file, originalContent, newContent)
}

const datadogCiPackage = loadPackage('datadog-ci')
const basePackage = loadPackage('base')

// The source of truth is the filesystem and `noPluginExceptions`
const pluginPackages = fs
  .readdirSync('packages')
  .filter((dir) => dir.startsWith('plugin-'))
  .map((dir) => {
    try {
      const {folder, packageJson} = loadPackage(dir)

      const scope = dir.replace('plugin-', '')
      const commands = findCommands(folder, scope)

      return {
        folder,
        packageJson,
        scope,
        commands,
      }
    } catch {
      console.log(chalk.yellow(`Could not load ${chalk.bold(dir)} package. Skipping it...\n`))

      return undefined
    }
  })
  .filter((p): p is PluginPackage => p !== undefined)

const exceptionScopes: CommandScope[] = [...noPluginExceptions].map((scope) => ({
  scope,
  commands: findCommands(path.join('packages/base/src/commands', scope), scope),
}))

type ApplyChanges = () => 0 | 1
type Replacer = (strings: TemplateStringsArray, replacement: string) => ApplyChanges

// XXX: `RegExp.escape()` is only available in Node.js 24
const escapeRegex = (part: string) => part.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')

const offsetAtIndex = (s: string, index: number) => {
  const upToIndex = s.slice(0, index)
  const lastNewLine = upToIndex.lastIndexOf('\n')
  const lineSubstring = upToIndex.slice(lastNewLine + 1)

  return lineSubstring.length - lineSubstring.trimStart().length
}

const indentString = (s: string, indent: number) => {
  return s.replace(/\n/g, '\n' + ' '.repeat(indent))
}

const success = (message: string): 0 => {
  console.log(chalk.green(message))

  return 0
}

const error = (message: string): 1 => {
  console.log(chalk.red(message))

  return 1
}

const makeApplyChanges = (
  file: string,
  originalContent: string,
  newContent: string,
  warnings?: string[]
): ApplyChanges => {
  const delta = diff(originalContent, newContent, {
    aColor: chalk.red,
    bColor: chalk.green,
    contextLines: 1,
    expand: false,
    omitAnnotationLines: true,
  })

  const applyChanges = (): 0 | 1 => {
    if (warnings) {
      console.warn(chalk.yellow(warnings.join('\n')))
    }

    if (!delta || delta.includes('no visual difference')) {
      return success(`${chalk.bold(file)} is up to date\n`)
    }

    console.log(`${chalk.bold(file)} should be updated:\n${delta}\n`)

    if (fix) {
      fs.writeFileSync(file, newContent)

      return success(`Updated ${chalk.bold(file)}\n`)
    } else {
      return error(`Run with ${chalk.bold('--fix')} to apply changes to ${chalk.bold(file)}\n`)
    }
  }

  return applyChanges
}

const matchAndReplace = (file: string): Replacer => {
  return (strings: TemplateStringsArray, replacement: string): ApplyChanges => {
    const warnings: string[] = []
    const originalContent = fs.readFileSync(file, 'utf8')

    // Remove leading and trailing newlines
    const before = strings[0][0] === '\n' ? strings[0].slice(1) : strings[0]
    const after = strings[1].at(-1) === '\n' ? strings[1].slice(0, -1) : strings[1]

    const beforeMatch = originalContent.match(escapeRegex(before))
    if (!beforeMatch?.index) {
      return () => error(`Could not match given before text in ${chalk.bold(file)}\n`)
    }

    const middleStart = beforeMatch.index + beforeMatch[0].length
    const middleAndAfter = originalContent.slice(middleStart)
    const afterMatch = middleAndAfter.match(escapeRegex(after))
    if (!afterMatch?.index) {
      warnings.push(
        `Could not match after text in ${chalk.bold(file)}\nWill add the middle text instead of replacing it.\n`
      )
    }

    const newContent =
      originalContent.slice(0, middleStart) + // < middle
      indentString(replacement, offsetAtIndex(originalContent, middleStart)) + // = middle
      (afterMatch?.index // > middle
        ? middleAndAfter.slice(afterMatch.index)
        : originalContent.slice(originalContent.indexOf(after)))

    return makeApplyChanges(file, originalContent, newContent, warnings)
  }
}

// Use "Fold All Regions" command in VSCode to collapse all regions

// #region ================================ REPLACERS ================================
const TO_APPLY: ApplyChanges[] = []

// #region - Format file: .github/workflows/ci.yml
const resolutions = ['@datadog/datadog-ci-base', ...pluginPackages.map((p) => p.packageJson.name)]
  .map((name) => `"${name}": "file:./artifacts/${name.replace('/', '-')}-\${{ matrix.version }}.tgz"`)
  .join(',\n')

TO_APPLY.push(matchAndReplace('.github/workflows/ci.yml')`
      - name: Create e2e project
        run: |
          echo '{
            "name": "datadog-ci-e2e-tests",
            "resolutions": {
              ${resolutions}
            },
            "dependencies": {
              "@datadog/datadog-ci": "./artifacts/@datadog-datadog-ci-\${{ matrix.version }}.tgz"
            }
          }' > package.json
`)
// #endregion

// #region - Format file: packages/base/package.json
TO_APPLY.push(matchAndReplace('packages/base/package.json')`
  "peerDependencies": {
    ${pluginPackages.map((p) => `"${p.packageJson.name}": "workspace:*"`).join(',\n')}
  }
`)

TO_APPLY.push(matchAndReplace('packages/base/package.json')`
  "peerDependenciesMeta": {
    ${pluginPackages.map((p) => `"${p.packageJson.name}": {\n  "optional": true\n}`).join(',\n')}
  }
`)
// #endregion

// #region - Format files: packages/base/src/cli.ts and packages/base/src/commands/<scope>/cli.ts
TO_APPLY.push(formatBasePackageCliFile())

TO_APPLY.push(...exceptionScopes.concat(pluginPackages).map(formatBasePackageScopeCliFile))
// #endregion

// #region - Format file: tsconfig.json
TO_APPLY.push(matchAndReplace('tsconfig.json')`
  "references": [
    {"path": "./packages/base"},
    {"path": "./packages/datadog-ci"},
    ${pluginPackages.map((p) => `{"path": "./packages/plugin-${p.scope}"}`).join(',\n')}
  ],
`)
// #endregion

// #region - Format file: packages/datadog-ci/tsconfig.json
const builtinPlugins = pluginPackages.filter((p) => p.packageJson.name in datadogCiPackage.packageJson.dependencies)
const installablePlugins = pluginPackages.filter(
  (p) => !(p.packageJson.name in datadogCiPackage.packageJson.dependencies)
)

TO_APPLY.push(matchAndReplace('packages/datadog-ci/tsconfig.json')`
  "references": [
    {"path": "../base"},
    ${builtinPlugins.map((p) => `{"path": "../plugin-${p.scope}"}`).join(',\n')}
  ]
`)
// #endregion

// #region - Format file: packages/datadog-ci/shims/injected-plugin-submodules.js
const formatBlock = (plugin: PluginPackage) => {
  return `'${plugin.scope}': {\n${plugin.commands.map((command) => `  '${command}': require('@datadog/datadog-ci-plugin-${plugin.scope}/commands/${command}'),`).join('\n')}\n},`
}

TO_APPLY.push(matchAndReplace('packages/datadog-ci/shims/injected-plugin-submodules.js')`
const injectedPluginSubmodules = {
  ${pluginPackages.map(formatBlock).join('\n')}
}
`)
// #endregion

// #region - Format file: container/Dockerfile
TO_APPLY.push(matchAndReplace('container/Dockerfile')`
RUN npm install -g @datadog/datadog-ci@$VERSION \\
    ${installablePlugins.map((p) => `@datadog/datadog-ci-plugin-${p.scope}@$VERSION \\`).join('\n')}
    && echo -e "Installed packages:\\n$(npm list -g | grep -o '@datadog/.*')"
`)
// #endregion

console.log(chalk.bold.blue('Linting files...\n'))

TO_APPLY.push(formatCodeownersFile())

const sum = TO_APPLY.map((apply) => apply()).reduce<number>((acc, result) => acc + result, 0)
if (sum > 0) {
  console.error(
    chalk.red(`Found ${chalk.bold(sum)} errors. Run ${chalk.bold('yarn lint:packages --fix')} to fix them.`)
  )
  process.exit(1)
}
// #endregion

// #region ================================ OTHER CHECKS ================================
console.log(chalk.bold.blue('Running other checks...\n'))

// #region - All packages have the same version
const allPackages = [datadogCiPackage, basePackage, ...pluginPackages]
const versions = allPackages.reduce<Record<string, string[]>>(
  (acc, p) => ({...acc, [p.packageJson.version]: [...(acc[p.packageJson.version] || []), p.packageJson.name]}),
  {}
)
if (Object.keys(versions).length > 1) {
  error(`All packages must have the same version. Found: ${JSON.stringify(versions, undefined, 2)}`)
  process.exit(1)
} else {
  success(`All packages have the same version: ${chalk.bold(Object.keys(versions)[0])}`)
}
// #endregion

// #region - All packages refer to local packages with `workspace:*`
const localReferenceRanges = allPackages.reduce<Record<string, string[]>>((acc, p) => {
  const ranges = new Set(
    Object.values({...p.packageJson.dependencies, ...p.packageJson.peerDependencies}).filter((range) =>
      range.startsWith('workspace:')
    )
  )

  return {
    ...acc,
    ...Object.fromEntries(Array.from(ranges).map((range) => [range, [...(acc[range] || []), p.packageJson.name]])),
  }
}, {})
if (Object.keys(localReferenceRanges).length > 1) {
  error(
    `All packages must refer to local packages with ${chalk.bold('workspace:*')}. Found: ${JSON.stringify(localReferenceRanges, undefined, 2)}`
  )
  process.exit(1)
} else if (Object.keys(localReferenceRanges).length === 1) {
  const range = Object.keys(localReferenceRanges)[0]

  if (range === 'workspace:*') {
    success(`All packages refer to local packages with ${chalk.bold('workspace:*')}`)
  } else {
    error(`All packages must refer to local packages with ${chalk.bold('workspace:*')}. Found: ${chalk.bold(range)}`)
    process.exit(1)
  }
}
// #endregion

// #region - Guard rail about making some plugins not built-in

const installablePlugins = pluginPackages.filter(
  (p) => !(p.packageJson.name in datadogCiPackage.packageJson.dependencies)
)
const impactedGithubActions = Object.fromEntries(
  installablePlugins.reduce<[string, string][]>(
    (acc, p) => [...acc, [p.scope, scopesWithUnpinnedDatadogCiInGithubAction[p.scope]]],
    []
  )
)

if (Object.keys(impactedGithubActions).length > 0) {
  error(
    `\n${chalk.bold('Detected newly installable plugin(s) with an associated GitHub Action that does not pin the version of @datadog/datadog-ci:')} ${JSON.stringify(impactedGithubActions, undefined, 2)}`
  )
  error(
    '\nRelying on the automatic installation of plugins in a GitHub Action is not recommended.\nIf you really want to change the list of built-in plugins, consider updating the impacted GitHub Actions with the newly installable plugin(s).'
  )
  process.exit(1)
}

// #endregion

// #endregion

try {
  exec('yarn knip', {throwError: isCI})
} catch (e) {
  console.log(chalk.red('Knip detected unused dependencies! Run `yarn lint:packages --fix` locally to fix it.\n'))
  process.exit(1)
}

exec('yarn install')
