import fs from 'fs'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import chalk from 'chalk'
// eslint-disable-next-line import-x/no-extraneous-dependencies
import {Cli} from 'clipanion'
import {diff} from 'jest-diff'

const fix = process.argv.includes('--fix')

type OptionDefinition = {
  flags: string[]
  description: string
  defaultValue: string | undefined
  shorthands: string[]
  hidden?: boolean
}

const error = (message: string): 1 => {
  console.log(chalk.red(message))

  return 1
}

const success = (message: string): 0 => {
  console.log(chalk.green(message))

  return 0
}

/**
 * Extract Boolean option defaults from source file
 * Parses the source code to find Option.Boolean(flags, defaultValue, ...) patterns
 */
const extractBooleanDefaults = (filePath: string): Map<string, string> => {
  const booleanDefaults = new Map<string, string>()

  try {
    const sourceCode = fs.readFileSync(filePath, 'utf8')

    // Match: Option.Boolean('flags', true/false, ...)
    // Handles both single and double quotes
    const booleanDefaultRegex = /Option\.Boolean\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(true|false)/g

    let match
    // eslint-disable-next-line no-null/no-null
    while ((match = booleanDefaultRegex.exec(sourceCode)) !== null) {
      const flagsString = match[1]
      const defaultVal = match[2]

      // Split flags by comma and trim each
      const flags = flagsString.split(',').map((f) => f.trim())

      // Store mapping for each flag
      flags.forEach((flag) => {
        booleanDefaults.set(flag, defaultVal)
      })
    }
  } catch (err) {
    // If we can't read the file, just return empty map
    console.warn(`Warning: Could not read ${filePath} for Boolean defaults extraction`)
  }

  return booleanDefaults
}

/**
 * Extract option definitions from a Clipanion command class
 * Uses Clipanion's CLI API to get evaluated option descriptions
 */
const extractOptionsFromCommand = (
  commandClass: any,
  booleanDefaults: Map<string, string> = new Map()
): OptionDefinition[] => {
  const cli = new Cli({binaryName: 'datadog-ci'})
  cli.register(commandClass)

  const definitions = cli.definitions()

  if (definitions.length === 0) {
    return []
  }

  const commandDef = definitions[0]
  const options: OptionDefinition[] = []

  for (const opt of commandDef.options) {
    // Parse the definition string to extract flags
    // Format: "-v,--layer-version,--layerVersion #0"
    // #0 means it takes a value, no #0 means boolean
    const defParts = opt.definition.split(/\s+/)
    const flagsString = defParts[0]
    const flags = flagsString.split(',')

    const longFlags = flags.filter((f: string) => f.startsWith('--'))
    const shortFlags = flags.filter((f: string) => f.startsWith('-') && !f.startsWith('--'))

    // Extract default value from description if present
    // Handles both "Defaults to 'value'" and "Defaults to value."
    let defaultValue: string | undefined
    let defaultMatch: RegExpMatchArray | undefined

    // Check Boolean defaults map first (more reliable than text extraction)
    for (const flag of flags) {
      if (booleanDefaults.has(flag)) {
        defaultValue = booleanDefaults.get(flag)
        break
      }
    }

    // If no Boolean default found, try extracting from description
    if (!defaultValue) {
      // Try matching with quotes first: "Defaults to 'value'"
      defaultMatch = opt.description?.match(/Defaults to '([^']*)'/) || undefined
      if (defaultMatch) {
        defaultValue = defaultMatch[1]
      } else {
        // Try matching without quotes: "Defaults to value." or "Defaults to value"
        const unquotedMatch = opt.description?.match(/Defaults to ([\w-]+)\.?/)
        if (unquotedMatch) {
          defaultValue = unquotedMatch[1]
          defaultMatch = unquotedMatch
        }
      }
    } else {
      // If we have a Boolean default, still check if description mentions it for cleaning
      defaultMatch = opt.description?.match(/Defaults to [^.]+\.?/) || undefined
    }

    // Clean "Defaults to ..." from description after extraction
    let cleanedDescription = opt.description || ''
    if (defaultMatch && cleanedDescription) {
      cleanedDescription = cleanedDescription
        // Remove "Defaults to 'value'" patterns
        .replace(/\.\s*Defaults to '[^']*'\s*/g, '. ')
        .replace(/\s*Defaults to '[^']*'\.\s*/g, '. ')
        .replace(/\s*Defaults to '[^']*'/g, '')
        // Remove "Defaults to value." patterns (unquoted)
        .replace(/\.\s*Defaults to [\w.-]+\.\s*/g, '. ')
        .replace(/\s*Defaults to [\w.-]+\.\s*/g, '. ')
        .replace(/\s*Defaults to [\w.-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.\s*\./g, '.')
    }

    // Check if option is hidden (not in the CLI definitions, so check if it's in the description)
    const hidden = opt.definition.includes('hidden') || false

    options.push({
      flags: longFlags,
      description: cleanedDescription,
      defaultValue,
      shorthands: shortFlags,
      hidden,
    })
  }

  return options
}

/**
 * Generate markdown table from options
 */
const generateTable = (options: OptionDefinition[]): string => {
  // Filter out universal options that shouldn't be in individual READMEs and hidden options
  const excludedFlags = ['--fips', '--fips-ignore-error']
  const filteredOptions = options.filter(
    (option) => !option.hidden && !option.flags.some((flag) => excludedFlags.includes(flag))
  )

  const rows: string[] = []
  rows.push('| Argument | Shorthand | Description | Default |')
  rows.push('| -------- | --------- | ----------- | ------- |')

  for (const option of filteredOptions) {
    const argument = option.flags.length > 0 ? `\`${option.flags.join('` or `')}\`` : ''
    const shorthand = option.shorthands.length > 0 ? `\`${option.shorthands.join('` or `')}\`` : ''
    const description = option.description || ''
    const defaultVal = option.defaultValue ? `\`${option.defaultValue}\`` : ''

    rows.push(`| ${argument} | ${shorthand} | ${description} | ${defaultVal} |`)
  }

  return rows.join('\n')
}

/**
 * Find command files for a given scope (checks both plugin and base packages)
 */
const findCommandFiles = (scope: string): {commandName: string; filePath: string}[] => {
  // First check if there's a base command directory for this scope
  const baseCommandsPath = path.join('packages/base/src/commands', scope)
  if (!fs.existsSync(baseCommandsPath)) {
    return []
  }

  const files = fs.readdirSync(baseCommandsPath)

  return files
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts' && file !== 'common.ts' && file !== 'cli.ts')
    .map((file) => ({
      commandName: file.replace('.ts', ''),
      filePath: path.join(baseCommandsPath, file),
    }))
}

/**
 * Extract options from a command file by dynamically importing its command class
 */
const extractOptionsFromFile = async (
  filePath: string,
  booleanDefaults?: Map<string, string>
): Promise<OptionDefinition[]> => {
  // Convert file path to import path
  // e.g., packages/base/src/commands/lambda/instrument.ts -> @datadog/datadog-ci-base/commands/lambda/instrument
  const importPath = filePath.replace('packages/base/src/', '@datadog/datadog-ci-base/').replace('.ts', '')

  // Extract Boolean defaults from source file if not provided
  const defaults = booleanDefaults || extractBooleanDefaults(filePath)

  try {
    const module = await import(importPath)

    // Find the command class in the module (typically the default export or a named export ending with 'Command')
    const commandClass = Object.values(module).find(
      (exp: any) => exp && typeof exp === 'function' && exp.name && exp.name.endsWith('Command')
    )

    if (!commandClass) {
      console.warn(`Warning: Could not find command class in ${importPath}`)

      return []
    }

    return extractOptionsFromCommand(commandClass, defaults)
  } catch (err) {
    console.error(`Error importing ${importPath}:`, err)

    return []
  }
}

/**
 * Update README with generated usage tables
 */
const updateReadme = (readmePath: string, commandOptionsMap: Map<string, OptionDefinition[]>): 0 | 1 => {
  if (!fs.existsSync(readmePath)) {
    return success(`${chalk.bold(readmePath)} does not exist, skipping...`)
  }

  const originalContent = fs.readFileSync(readmePath, 'utf8')
  let newContent = originalContent

  for (const [commandName, options] of commandOptionsMap.entries()) {
    const beginMarker = `<!-- BEGIN_USAGE:${commandName} -->`
    const endMarker = `<!-- END_USAGE:${commandName} -->`

    const beginIndex = newContent.indexOf(beginMarker)
    const endIndex = newContent.indexOf(endMarker)

    if (beginIndex === -1 || endIndex === -1) {
      console.log(chalk.yellow(`Markers not found for command '${commandName}' in ${readmePath}, skipping...`))
      continue
    }

    const table = generateTable(options)
    newContent = newContent.slice(0, beginIndex + beginMarker.length) + '\n' + table + '\n' + newContent.slice(endIndex)
  }

  if (originalContent === newContent) {
    return success(`${chalk.bold(readmePath)} is up to date`)
  }

  const delta = diff(originalContent, newContent, {
    aColor: chalk.red,
    bColor: chalk.green,
    contextLines: 3,
    expand: false,
    omitAnnotationLines: true,
  })

  console.log(`${chalk.bold(readmePath)} should be updated:\n${delta}\n`)

  if (fix) {
    fs.writeFileSync(readmePath, newContent)

    return success(`Updated ${chalk.bold(readmePath)}`)
  }

  return error(`Run with ${chalk.bold('--fix')} to apply changes to ${chalk.bold(readmePath)}`)
}

// Main execution

;(async () => {
  console.log(chalk.bold.blue('Linting README usage tables...\n'))

  const pluginPackages = fs
    .readdirSync('packages')
    .filter((dir) => dir.startsWith('plugin-'))
    .map((dir) => ({
      scope: dir.replace('plugin-', ''),
      packagePath: path.join('packages', dir),
    }))

  type ApplyChanges = () => 0 | 1
  const TO_APPLY: ApplyChanges[] = []

  for (const {scope, packagePath} of pluginPackages) {
    const commandFiles = findCommandFiles(scope)

    if (commandFiles.length === 0) {
      continue
    }

    // Extract options from common.ts if it exists (shared options from parent class)
    const commonPath = path.join('packages/base/src/commands', scope, 'common.ts')
    const commonBooleanDefaults = fs.existsSync(commonPath) ? extractBooleanDefaults(commonPath) : new Map()
    const commonOptions = fs.existsSync(commonPath) ? await extractOptionsFromFile(commonPath) : []

    const commandOptionsMap = new Map<string, OptionDefinition[]>()

    for (const {commandName, filePath} of commandFiles) {
      // Merge Boolean defaults from common.ts and command-specific file
      const commandBooleanDefaults = extractBooleanDefaults(filePath)
      const mergedBooleanDefaults = new Map([...commonBooleanDefaults, ...commandBooleanDefaults])

      // Extract command-specific options with merged Boolean defaults
      const commandSpecificOptions = await extractOptionsFromFile(filePath, mergedBooleanDefaults)

      // Merge common options with command-specific options
      const allOptions = [...commonOptions, ...commandSpecificOptions]
      if (allOptions.length > 0) {
        commandOptionsMap.set(commandName, allOptions)
      }
    }

    if (commandOptionsMap.size > 0) {
      const readmePath = path.join(packagePath, 'README.md')
      TO_APPLY.push(() => updateReadme(readmePath, commandOptionsMap))
    }
  }

  const sum = TO_APPLY.map((apply) => apply()).reduce<number>((acc, result) => acc + result, 0)

  if (sum > 0) {
    console.error(
      chalk.red(`\nFound ${chalk.bold(sum)} errors. Run ${chalk.bold('yarn lint:readme-usage --fix')} to fix them.`)
    )
    process.exit(1)
  }

  console.log(chalk.green.bold('\n✅ All README usage tables are up to date!\n'))
})()
