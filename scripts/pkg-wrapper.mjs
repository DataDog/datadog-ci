import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chmodSync, createWriteStream} from 'node:fs'
import {mkdir, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'
import {parseArgs} from 'node:util'

import chalk from 'chalk'

const require = createRequire(import.meta.url)
const sea = require('@yao-pkg/pkg/lib-es5/sea').default

// Contains Node.js binaries built using `--with-intl=none`. See https://github.com/Drarig29/pkg-fetch
export const PKG_FETCH_RELEASE = 'https://github.com/Drarig29/pkg-fetch/releases/download/v1.0'

// Should be aligned with `STANDALONE_NODE_VERSION` in CI
const NODE_VERSIONS = {
  node22: 'v22.19.0',
}

const downloadToFile = async (url, destPath) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  await pipeline(response.body, createWriteStream(destPath))
}

const verifyChecksum = async (filePath, checksumPath) => {
  const expectedChecksum = (await readFile(checksumPath, 'utf8')).trim().split(/\s+/)[0]
  const actualChecksum = createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')

  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${filePath}: expected ${expectedChecksum}, got ${actualChecksum}`)
  }
}

const adHocSign = async (filePath) => {
  if (process.platform !== 'darwin') {
    return
  }

  console.log(chalk.cyan(`Ad-hoc signing ${filePath}`))
  await runCommand('codesign', ['-s', '-', filePath])
}

/**
 * @param {string} target Same target as `pkg` command. Example: `node22-macos-x64`.
 */
const downloadTrimmedNodeBinary = async (target) => {
  const [nodeRange, platform, arch] = target.split('-')
  const nodeVersion = NODE_VERSIONS[nodeRange]
  if (!nodeVersion || !platform || !arch) {
    throw new Error(`Unsupported target "${target}"`)
  }

  const assetFileName = `node-${nodeVersion}-${platform}-${arch}` // e.g. node-v22.22.2-macos-x64
  const checksumFileName = `${assetFileName}.sha256sum`
  const assetUrl = `${PKG_FETCH_RELEASE}/${assetFileName}`
  const checksumUrl = `${PKG_FETCH_RELEASE}/${checksumFileName}`
  const outputDirectory = path.resolve('.sea', 'trimmed-node', assetFileName)
  const outputNodePath = path.join(outputDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
  const outputChecksumPath = path.join(outputDirectory, checksumFileName)

  await mkdir(outputDirectory, {recursive: true})
  console.log(`Downloading ${chalk.cyan(assetUrl)} to ${chalk.green(outputNodePath)}`)

  await downloadToFile(assetUrl, outputNodePath)
  await downloadToFile(checksumUrl, outputChecksumPath)
  await verifyChecksum(outputNodePath, outputChecksumPath)
  console.log(`Verified checksum for ${chalk.green(assetFileName)}`)

  if (process.platform !== 'win32') {
    chmodSync(outputNodePath, 0o755)
  }
  await adHocSign(outputNodePath)

  return outputNodePath
}

const toNodeTarget = (target, output) => {
  const [nodeRange, platform, arch] = target.split('-')
  if (!nodeRange || !platform || !arch) {
    throw new Error(`Unsupported target "${target}"`)
  }

  return {
    arch,
    nodeRange,
    output: path.resolve(output),
    platform,
  }
}

const runPkg = async (nodePath, target, output) =>
  sea('packages/datadog-ci/dist/bundle.js', {
    // nodePath,
    useLocalNode: true,
    signature: true,
    targets: [toNodeTarget(target, output)],
  })

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', ...options})

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`))

        return
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`))

        return
      }
      resolve()
    })
  })

const {values} = parseArgs({
  options: {
    t: {type: 'string'},
    o: {type: 'string'},
  },
})

if (!values.t || !values.o) {
  throw new Error('Both -t and -o are required')
}

console.log(chalk.bold.green(`\nRunning ${process.argv.join(' ')}`))
if (values.t.includes('-win-')) {
  console.log(chalk.bold.green(`Adding .exe extension to output path`))
  values.o = `${values.o}.exe`
}
const trimmedNodePath = await downloadTrimmedNodeBinary(values.t)
await runPkg(trimmedNodePath, values.t, values.o)
