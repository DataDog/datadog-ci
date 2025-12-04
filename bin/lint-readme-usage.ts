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
 * Parse a TypeScript file and extract Clipanion option definitions
 */
const parseCommandFile = (filePath: string): OptionDefinition[] => {
  const sourceCode = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true)

  // Build a map of constants
  const constants = new Map<string, string>()

  const collectConstants = (file: ts.SourceFile) => {
    const visitNode = (node: ts.Node) => {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            if (ts.isStringLiteral(declaration.initializer)) {
              constants.set(declaration.name.text, declaration.initializer.text)
            } else if (ts.isNumericLiteral(declaration.initializer)) {
              constants.set(declaration.name.text, declaration.initializer.text)
            }
          }
        }
      }
      ts.forEachChild(node, visitNode)
    }
    visitNode(file)
  }

  // Collect constants from current file
  collectConstants(sourceFile)

  // Also collect from constants.ts if it exists
  const constantsFilePath = path.join(path.dirname(filePath), '..', '..', 'helpers', 'serverless', 'constants.ts')
  if (fs.existsSync(constantsFilePath)) {
    const constantsSource = fs.readFileSync(constantsFilePath, 'utf8')
    const constantsFile = ts.createSourceFile(constantsFilePath, constantsSource, ts.ScriptTarget.Latest, true)
    collectConstants(constantsFile)
  }

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
            const option = parseOptionDefinition(args, optionType, constants)
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
const parseOptionDefinition = (
  args: ts.NodeArray<ts.Expression>,
  optionType: string,
  constants: Map<string, string>
): OptionDefinition | undefined => {
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
  let hidden = false

  // For Boolean options: Option.Boolean(flags, default, options) or Option.Boolean(flags, options)
  // For String/Array options: Option.String(flags, default?, options)
  if (optionType === 'Boolean') {
    // Check if args[1] is options object or default value
    if (args.length > 1) {
      if (ts.isObjectLiteralExpression(args[1])) {
        // args[1] is options object (no default specified)
        const result = extractDescription(args[1], constants)
        description = result.description
        hidden = result.hidden || false
      } else if (args[1].kind === ts.SyntaxKind.TrueKeyword) {
        defaultValue = 'true'
        // args[2] might be options object
        if (args.length > 2 && ts.isObjectLiteralExpression(args[2])) {
          const result = extractDescription(args[2], constants)
          description = result.description
          hidden = result.hidden || false
        }
      } else if (args[1].kind === ts.SyntaxKind.FalseKeyword) {
        defaultValue = 'false'
        // args[2] might be options object
        if (args.length > 2 && ts.isObjectLiteralExpression(args[2])) {
          const result = extractDescription(args[2], constants)
          description = result.description
          hidden = result.hidden || false
        }
      }
    }
  }

  // For String/Array: could be Option.String(flags, options) or Option.String(flags, default, options)
  if (optionType !== 'Boolean' && args.length > 1) {
    if (ts.isObjectLiteralExpression(args[1])) {
      // No default, just options
      const result = extractDescription(args[1], constants)
      description = result.description
      hidden = result.hidden || false
      if (result.extractedDefault) {
        defaultValue = result.extractedDefault
      }
    } else if (ts.isStringLiteral(args[1]) || ts.isIdentifier(args[1]) || ts.isArrayLiteralExpression(args[1])) {
      // Has default value
      if (ts.isStringLiteral(args[1])) {
        defaultValue = args[1].text
      } else if (ts.isIdentifier(args[1])) {
        // It's a constant reference - will try to get from description
        defaultValue = undefined
      } else if (ts.isArrayLiteralExpression(args[1])) {
        // It's an array literal like []
        const sourceFile = args[1].getSourceFile()
        defaultValue = args[1].getText(sourceFile)
      }

      // Check for options object
      if (args.length > 2 && ts.isObjectLiteralExpression(args[2])) {
        const result = extractDescription(args[2], constants)
        description = result.description
        hidden = result.hidden || false
        // If we didn't get a default value from the argument, try to extract from description
        if (!defaultValue && result.extractedDefault) {
          defaultValue = result.extractedDefault
        }
      }
    }
  }

  return {
    flags: longFlags,
    description: description || '',
    defaultValue,
    shorthands: shortFlags,
    hidden,
  }
}

/**
 * Extract description and hidden flag from options object literal and optionally extract default value
 */
const extractDescription = (
  optionsObject: ts.ObjectLiteralExpression,
  constants: Map<string, string>
): {description: string; extractedDefault?: string; hidden?: boolean} => {
  let hidden = false
  for (const prop of optionsObject.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'hidden') {
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        hidden = true
      }
    }
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'description') {
      if (ts.isStringLiteral(prop.initializer)) {
        return {description: prop.initializer.text, hidden}
      }

      // Handle template literals (e.g., `text ${var}`)
      if (ts.isTemplateExpression(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
        let extractedDefault: string | undefined

        // For template expressions, extract values from ${...} in "Defaults to '${...}'" pattern
        if (ts.isTemplateExpression(prop.initializer)) {
          let fullText = prop.initializer.head.text
          for (const span of prop.initializer.templateSpans) {
            // Check if this span is in a "Defaults to '...'" pattern
            const textBefore = fullText
            if (textBefore.includes("Defaults to '") && !extractedDefault) {
              // This is the default value - resolve it from constants
              if (ts.isIdentifier(span.expression)) {
                const constantName = span.expression.text
                extractedDefault = constants.get(constantName) || constantName
              } else {
                const exprSourceFile = span.expression.getSourceFile()
                extractedDefault = span.expression.getText(exprSourceFile)
              }
            }
            fullText += span.literal.text
          }

          // Build cleaned description
          let descriptionText = prop.initializer.head.text
          for (const span of prop.initializer.templateSpans) {
            descriptionText += span.literal.text
          }

          // Remove "Defaults to '...'" parts
          descriptionText = descriptionText.replace(/\.\s*Defaults to '[^']*'\s*/g, '. ')
          descriptionText = descriptionText.replace(/\s*Defaults to '[^']*'\.\s*/g, '. ')
          descriptionText = descriptionText.replace(/\s*Defaults to '[^']*'/g, '')
          descriptionText = descriptionText.replace(/\s+/g, ' ').trim()
          descriptionText = descriptionText.replace(/\.\s*\./g, '.')

          return {description: descriptionText, extractedDefault, hidden}
        }

        // For non-substitution template literals
        const sourceFile = prop.getSourceFile()
        let text = prop.initializer.getText(sourceFile)
        // Remove backticks
        text = text.slice(1, -1)

        // Extract default value from "Defaults to '...'" pattern
        const defaultMatch = text.match(/Defaults to '([^']*)'/)
        if (defaultMatch) {
          extractedDefault = defaultMatch[1]
        }

        // Remove "Defaults to '...'" parts
        text = text.replace(/\.\s*Defaults to '[^']*'\s*/g, '. ')
        text = text.replace(/\s*Defaults to '[^']*'\.\s*/g, '. ')
        text = text.replace(/\s*Defaults to '[^']*'/g, '')
        text = text.replace(/\s+/g, ' ').trim()
        text = text.replace(/\.\s*\./g, '.')

        return {description: text, extractedDefault, hidden}
      }
    }
  }

  return {description: '', hidden}
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
