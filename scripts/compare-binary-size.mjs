import {execFileSync} from 'node:child_process'
import {mkdtempSync, statSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import chalk from 'chalk'

import {downloadOfficialNodeBinary, getOfficialNodeDownload} from './node-download.mjs'

const formatFileSize = (bytes) => {
  const units = ['B', 'KB', 'MB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

const runVersion = (executablePath) => {
  try {
    const result = execFileSync(executablePath, ['--version'], {encoding: 'utf8', timeout: 5000})

    return result.trim()
  } catch (error) {
    return `Error: ${error.message}`
  }
}

// Check if a file argument was provided
const fileArg = process.argv[2]

if (!fileArg) {
  console.log(chalk.red('\nUsage: yarn compare-binary-size <filename>'))
  process.exit(1)
}

console.log(chalk.bold.blue('Node.js Binary Size Comparison'))
console.log(chalk.gray('===================================\n'))

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'datadog-ci-node-'))
const {url} = getOfficialNodeDownload()

console.log(chalk.cyan(`${chalk.bold('Official')} Node.js archive:`), chalk.white(url))
const nodePath = await downloadOfficialNodeBinary(tempDir)

// Get Node.js binary size
const nodeSize = statSync(nodePath).size

console.log(chalk.cyan(`${chalk.bold('Official')} Node.js executable path:`), chalk.white(nodePath))
console.log(chalk.cyan(`${chalk.bold('Official')} Node.js binary size:`), chalk.bold.magenta(formatFileSize(nodeSize)))

// Run --version on Node.js binary
console.log(chalk.yellow(`Output of --version:`), runVersion(nodePath))

// Get the provided file size
const filePath = path.resolve(fileArg)
const fileSize = statSync(filePath).size

console.log(chalk.cyan(`\n${chalk.bold('Given')} binary path:`), chalk.white(filePath))
console.log(chalk.cyan(`${chalk.bold('Given')} binary size:`), chalk.bold.magenta(formatFileSize(fileSize)))

// Run --version on the provided file
console.log(chalk.yellow(`Output of --version:`), runVersion(filePath))

// Compare sizes
const ratio = fileSize / nodeSize
console.log(chalk.bold.magenta('\nComparison:'))
console.log(
  chalk.white(`  ${chalk.bold('Given')} binary is ${chalk.bold(ratio.toFixed(2))}x the size of Node.js binary`)
)

if (fileSize > nodeSize) {
  console.log(
    chalk.red(
      `  ${chalk.bold('Given')} binary is ${chalk.bold(formatFileSize(fileSize - nodeSize))} larger than Node.js binary`
    )
  )
} else {
  console.log(
    chalk.green(
      `  ${chalk.bold('Given')} binary is ${chalk.bold(formatFileSize(nodeSize - fileSize))} smaller than Node.js binary`
    )
  )
}
