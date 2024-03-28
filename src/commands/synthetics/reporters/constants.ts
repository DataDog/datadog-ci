import chalk from 'chalk'

export const ICONS = {
  FAILED: chalk.bold.red('✖'),
  FAILED_NON_BLOCKING: chalk.bold.yellow('✖'),
  SKIPPED: chalk.bold.yellow('⇢'),
  SUCCESS: chalk.bold.green('✓'),
}
