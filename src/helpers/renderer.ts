import path from 'path'
import process from 'process'

import chalk, {bold, cyan, green, red, yellow} from 'chalk'

export const dryRunTag = bold(cyan('[Dry Run]'))
export const errorTag = bold(red('[Error]'))
export const warningTag = bold(yellow('[Warning]'))

export const warningExclamationSignTag = bold(yellow('[!]'))
export const successCheckmarkTag = bold(green('✔'))
export const failCrossTag = bold(red('✖'))

/**
 * @param error an error message or an object of type `unknown`*.
 * @returns the provided error prefixed by {@link errorTag}.
 *
 * * Using unknown since we're not type guarding.
 *
 * ```txt
 * [Error] The provided error goes here!
 * ```
 */
export const renderError = (error: unknown) => `${errorTag} ${error}\n`

/**
 * @param warning the message to warn about.
 * @returns the provided warning prefixed by {@link warningExclamationSignTag}.
 *
 * ```txt
 * [!] The provided warning goes here!
 * ```
 */
export const renderSoftWarning = (warning: string) => `${warningExclamationSignTag} ${warning}\n`

/**
 * @returns a header indicating on which platform the 'flare' command is being run.
 * @param platformName the name of the platform. E.g. 'Cloud Run' or 'Lambda'.
 * @param isDryRun whether or not the command is a dry run.
 *
 * ```txt
 * [Dry Run] 🐶 Instrumenting Lambda function
 * ```
 */
export const renderFlareHeader = (platformName: string, isDryRun: boolean) => {
  const prefix = isDryRun ? `${dryRunTag} ` : ''

  return bold(`\n${prefix}🐶 Generating ${platformName} flare to send your configuration to Datadog...\n`)
}

/**
 * @returns a message indicating which proejct files were found, or a different
 * message if no project files were found.
 * @param projectFilePaths list of project file paths that were discovered
 *
 * ```txt
 * ✅ Found project file(s) in /Users/current-directory:
 * • package.json
 * • tsconfig.json
 * ```
 */
export const renderProjectFiles = (projectFilePaths: Set<string>) => {
  if (projectFilePaths.size === 0) {
    return renderSoftWarning('No project files found.')
  }
  let msg = chalk.bold(`\n✅ Found project file(s) in ${process.cwd()}:\n`)
  for (const filePath of projectFilePaths) {
    const fileName = path.basename(filePath)
    msg += `• ${fileName}\n`
  }

  return msg
}
