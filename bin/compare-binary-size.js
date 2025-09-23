'use strict'

const {execSync} = require('child_process')
const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

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
    const result = execSync(`"${executablePath}" --version`, {encoding: 'utf8', timeout: 5000})

    return result.trim()
  } catch (error) {
    return `Error: ${error.message}`
  }
}

console.log(chalk.bold.blue('Node.js Binary Size Comparison'))
console.log(chalk.gray('===================================\n'))

// Get Node.js binary size
const nodePath = process.execPath
const nodeSize = fs.statSync(nodePath).size

console.log(chalk.cyan(`${chalk.bold('Current')} Node.js executable path:`), chalk.white(nodePath))
console.log(chalk.cyan(`${chalk.bold('Current')} Node.js binary size:`), chalk.bold.magenta(formatFileSize(nodeSize)))

// Run --version on Node.js binary
console.log(chalk.yellow(`Output of --version:`), runVersion(nodePath))

// Check if a file argument was provided
const fileArg = process.argv[2]

if (!fileArg) {
  console.log(chalk.red('\nUsage: yarn compare-binary-size <filename>'))
  process.exit(1)
}

// Get the provided file size
const filePath = path.resolve(fileArg)
const fileSize = fs.statSync(filePath).size

console.log(chalk.cyan(`\n${chalk.bold('Given')} Node.js binary path:`), chalk.white(filePath))
console.log(chalk.cyan(`${chalk.bold('Given')} Node.js binary size:`), chalk.bold.magenta(formatFileSize(fileSize)))

// Run --version on the provided file
console.log(chalk.yellow(`Output of --version:`), runVersion(filePath))

// Compare sizes
const ratio = fileSize / nodeSize
console.log(chalk.bold.magenta('\nComparison:'))
console.log(
  chalk.white(`  ${chalk.bold('Given')} Node.js binary is ${chalk.bold(ratio.toFixed(2))}x the size of Node.js binary`)
)

if (fileSize > nodeSize) {
  console.log(
    chalk.red(
      `  ${chalk.bold('Given')} Node.js binary is ${chalk.bold(formatFileSize(fileSize - nodeSize))} larger than Node.js binary`
    )
  )
} else {
  console.log(
    chalk.green(
      `  ${chalk.bold('Given')} Node.js binary is ${chalk.bold(formatFileSize(nodeSize - fileSize))} smaller than Node.js binary`
    )
  )
}
