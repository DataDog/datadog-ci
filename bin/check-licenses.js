'use strict'

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

const LICENSE_FILE = 'LICENSE-3rdparty.csv'

async function main() {
  const packageJsonPaths = await findPackageJsonPaths()

  console.log(`Look for dependencies in:\n`, packageJsonPaths, '\n')
  const declaredDependencies = withoutDuplicates(
    packageJsonPaths.reduce((acc, packageJsonPath) => acc.concat(retrievePackageJsonDependencies(packageJsonPath)), [])
  ).sort()

  const {licenses, hasColumnCountMismatch} = await retrieveLicenses()
  const declaredLicenses = licenses.sort()

  if (JSON.stringify(declaredDependencies) !== JSON.stringify(declaredLicenses)) {
    console.error(JSON.stringify(declaredDependencies, null, 2))
    console.error(JSON.stringify(declaredLicenses, null, 2))
    console.error(`\n❌ package.json dependencies and ${LICENSE_FILE} mismatch`)
    console.error(
      `\nIn package.json but not in ${LICENSE_FILE}:\n`,
      declaredDependencies.filter((d) => !declaredLicenses.includes(d))
    )
    console.error(
      `\nIn ${LICENSE_FILE} but not in package.json:\n`,
      declaredLicenses.filter((d) => !declaredDependencies.includes(d))
    )
    throw new Error('dependencies mismatch')
  }

  console.log(`\n✅ All dependencies listed in ${LICENSE_FILE}`)

  if (hasColumnCountMismatch) {
    throw Error('The CSV format is incorrect. You may have an extra comma in a copyright.')
  }
}

async function findPackageJsonPaths() {
  const {stdout} = await exec('find . -path "*/node_modules/*" -prune -o -name "package.json" -print')
  return stdout.trim().split('\n')
}

function retrievePackageJsonDependencies(packageJsonPath) {
  const packageJson = require(path.join(__dirname, '..', packageJsonPath))

  return Object.keys(packageJson.dependencies || {})
    .concat(Object.keys(packageJson.devDependencies || {}))
    .filter((dependency) => !dependency.includes('@datadog'))
}

function withoutDuplicates(a) {
  return [...new Set(a)]
}

function parseCSVLine(line) {
  return line.match(/("[^"]*")|[^,]+/g)
}

async function retrieveLicenses() {
  const fileStream = fs.createReadStream(path.join(__dirname, '..', LICENSE_FILE))
  const lines = readline.createInterface({input: fileStream})
  const licenses = []

  let header = true
  let headerColumnCount
  let hasColumnCountMismatch = false
  let lineNumber = 1

  for await (const line of lines) {
    const csvColumns = parseCSVLine(line)
    if (header) {
      headerColumnCount = csvColumns.length
    }
    if (!header && csvColumns[0] !== 'file') {
      licenses.push(csvColumns[0])

      if (csvColumns.length !== headerColumnCount) {
        console.warn(
          `${LICENSE_FILE}: Line ${lineNumber} has ${csvColumns.length} columns, but header has ${headerColumnCount}.`
        )
        hasColumnCountMismatch = true
      }
    }
    header = false
    lineNumber++
  }

  return {licenses, hasColumnCountMismatch}
}

main().catch((e) => {
  console.error('\nStacktrace:\n', e)
  process.exit(1)
})
