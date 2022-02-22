const util = require('util')
const {version} = require('../package.json')
const exec = util.promisify(require('child_process').exec)

const STANDALONE_BINARY_PATH = './datadog-ci'

function sanitizeOutput(output) {
  return output.replace(/(\r\n|\n|\r)/gm, '')
}

// This file is a simple test for the generated standalone binary datadog-ci
async function main() {
  const {stdout} = await exec(`${STANDALONE_BINARY_PATH} version`)
  const binaryVersion = sanitizeOutput(stdout)
  // .slice(1) to remove the "v"
  if (version !== binaryVersion.slice(1)) {
    throw new Error(`./datadog-ci version outputs an incorrect version: ${binaryVersion}`)
  }
}

main().catch((e) => {
  console.error('\nStacktrace:\n', e)
  process.exit(1)
})
