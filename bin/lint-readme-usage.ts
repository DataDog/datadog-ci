import fs from 'fs'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import chalk from 'chalk'
import {diff} from 'jest-diff'
import ts from 'typescript'

const fix = process.argv.includes('--fix')

type OptionDefinition = {
  flags: string[]
  description: string
  defaultValue: string | undefined
  shorthand: string | undefined
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
 * Parse a TypeScript file and extract Clipanion option definitions
 */
const parseCommandFile = (filePath: string): OptionDefinition[] => {
  const sourceCode = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true)

  const options: OptionDefinition[] = []

  const visit = (node: ts.Node) => {
    // Look for property declarations that use Option.String, Option.Boolean, etc.
    if (ts.isPropertyDeclaration(node)) {
      const initializer = node.initializer
      if (initializer && ts.isCallExpression(initializer)) {
        const expression = initializer.expression
        // Check if it's Option.String, Option.Boolean, Option.Array, etc.
        if (
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === 'Option'
        ) {
          const optionType = expression.name.text
          const args = initializer.arguments

          if (args.length > 0) {
            const option = parseOptionDefinition(args, optionType)
            if (option) {
              options.push(option)
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return options
}

/**
 * Parse Option.* call arguments to extract flag, default, and description
 */
const parseOptionDefinition = (args: ts.NodeArray<ts.Expression>, optionType: string): OptionDefinition | undefined => {
  if (args.length === 0) {
    return undefined
  }

  // First argument is always the flag(s)
  const flagsArg = args[0]
  if (!ts.isStringLiteral(flagsArg)) {
    return undefined
  }

  const flags = flagsArg.text.split(',').map((f) => f.trim())
  const longFlags = flags.filter((f) => f.startsWith('--'))
  const shortFlags = flags.filter((f) => f.startsWith('-') && !f.startsWith('--'))

  let defaultValue: string | undefined
  let description = ''

  // For Boolean options: Option.Boolean(flags, default, options)
  // For String/Array options: Option.String(flags, default?, options)
  if (optionType === 'Boolean') {
    // args[1] is default value for Boolean
    if (args.length > 1) {
      if (args[1].kind === ts.SyntaxKind.TrueKeyword) {
        defaultValue = 'true'
      } else if (args[1].kind === ts.SyntaxKind.FalseKeyword) {
        defaultValue = 'false'
      }
    }

    // args[2] is options object for Boolean
    if (args.length > 2 && ts.isObjectLiteralExpression(args[2])) {
      description = extractDescription(args[2])
    }
  }

  // For String/Array: could be Option.String(flags, options) or Option.String(flags, default, options)
  if (optionType !== 'Boolean' && args.length > 1) {
    if (ts.isObjectLiteralExpression(args[1])) {
      // No default, just options
      description = extractDescription(args[1])
    } else if (ts.isStringLiteral(args[1]) || ts.isIdentifier(args[1])) {
      // Has default value
      if (ts.isStringLiteral(args[1])) {
        defaultValue = args[1].text
      } else if (ts.isIdentifier(args[1])) {
        // It's a constant reference, we'll use the identifier name
        defaultValue = args[1].text
      }

      // Check for options object
      if (args.length > 2 && ts.isObjectLiteralExpression(args[2])) {
        description = extractDescription(args[2])
      }
    }
  }

  return {
    flags: longFlags,
    description: description || '',
    defaultValue,
    shorthand: shortFlags[0],
  }
}

/**
 * Extract description from options object literal
 */
const extractDescription = (optionsObject: ts.ObjectLiteralExpression): string => {
  for (const prop of optionsObject.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'description') {
      if (ts.isStringLiteral(prop.initializer)) {
        return prop.initializer.text
      }

      // Handle template literals (e.g., `text ${var}`)
      if (ts.isTemplateExpression(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
        // For template literals, we'll extract the raw text and convert ${...} to literal text
        const sourceFile = prop.getSourceFile()
        let text = prop.initializer.getText(sourceFile)
        // Remove backticks
        text = text.slice(1, -1)
        // Remove "Defaults to '${...}'" parts since we have a Default column
        text = text.replace(/\.\s*Defaults to '[^']*'\s*/g, '. ')
        text = text.replace(/\s*Defaults to '[^']*'\.\s*/g, '. ')
        text = text.replace(/\s*Defaults to '[^']*'/g, '')
        // Clean up any double spaces or trailing/leading spaces
        text = text.replace(/\s+/g, ' ').trim()
        // Clean up double periods
        text = text.replace(/\.\s*\./g, '.')

        return text
      }
    }
  }

  return ''
}

/**
 * Generate markdown table from options
 */
const generateTable = (options: OptionDefinition[]): string => {
  // Filter out universal options that shouldn't be in individual READMEs
  const excludedFlags = ['--fips', '--fips-ignore-error']
  const filteredOptions = options.filter((option) => !option.flags.some((flag) => excludedFlags.includes(flag)))

  const rows: string[] = []
  rows.push('| Argument | Shorthand | Description | Default |')
  rows.push('| -------- | --------- | ----------- | ------- |')

  for (const option of filteredOptions) {
    const argument = option.flags.length > 0 ? `\`${option.flags.join('` or `')}\`` : ''
    const shorthand = option.shorthand ? `\`${option.shorthand}\`` : ''
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

  // Parse common.ts to get shared options from parent class
  const commonPath = path.join('packages/base/src/commands', scope, 'common.ts')
  const commonOptions = fs.existsSync(commonPath) ? parseCommandFile(commonPath) : []

  const commandOptionsMap = new Map<string, OptionDefinition[]>()

  for (const {commandName, filePath} of commandFiles) {
    const commandSpecificOptions = parseCommandFile(filePath)
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
