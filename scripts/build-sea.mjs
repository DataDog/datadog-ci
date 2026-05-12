import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {chmod, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {pipeline} from 'node:stream/promises'
import {fileURLToPath} from 'node:url'
import {parseArgs, styleText} from 'node:util'

import {downloadToFile, getPkgFetchBinaryName, NODE_VERSION, PKG_FETCH_RELEASE} from './node-download.mjs'

const SUPPORTED_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'macos-x64',
  'macos-arm64',
  'win-x64',
  // TODO: enable these and update the tests
  // 'win-arm64',
  // 'alpine-x64',
  // 'alpine-arm64',
]

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

const verifySha256 = async (filePath, expected) => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${filePath}:\n  expected ${expected}\n  got      ${actual}`)
  }
}

const {values} = parseArgs({
  options: {
    t: {type: 'string'},
    o: {type: 'string'},
  },
})

if (!values.t || !values.o) {
  console.error('Usage: node scripts/build-sea.mjs -t <target> -o <output>')
  console.error(`  target examples: node26-linux-x64, linux-x64`)
  process.exit(1)
}

const platformKey = values.t.replace(/^node\d+-/, '')
if (!SUPPORTED_PLATFORMS.includes(platformKey)) {
  console.error(`Unknown target: ${values.t}`)
  console.error(`Supported targets: ${SUPPORTED_PLATFORMS.join(', ')}`)
  process.exit(1)
}

const isWindows = platformKey.startsWith('win-')
const isMacOS = platformKey.startsWith('macos-')

// The `.exe` extension is necessary for Windows.
const outputPath = resolve(REPO_ROOT, isWindows ? `${values.o}.exe` : values.o)
const bundlePath = resolve(REPO_ROOT, 'packages/datadog-ci/dist/bundle.js')
const binaryName = getPkgFetchBinaryName(platformKey)

const seaDir = join(REPO_ROOT, '.sea')
const nodeBinPath = join(seaDir, isWindows ? 'node.exe' : 'node')
await rm(seaDir, {recursive: true, force: true})
await mkdir(seaDir)

console.log(`Downloading Node.js ${NODE_VERSION} for ${platformKey}...`)
await Promise.all([
  downloadToFile(`${PKG_FETCH_RELEASE}/${binaryName}`, nodeBinPath),
  downloadToFile(`${PKG_FETCH_RELEASE}/${binaryName}.sha256sum`, join(seaDir, 'node.sha256sum')),
])

console.log('Verifying checksum...')
const sha256sumContent = await readFile(join(seaDir, 'node.sha256sum'), 'utf8')
const expectedHash = sha256sumContent.split(/\s+/)[0]
await verifySha256(nodeBinPath, expectedHash)
console.log('Checksum OK')

await chmod(nodeBinPath, 0o755)

if (isMacOS) {
  // Sign with ad-hoc signature (`-`) to run `node --build-sea` successfully.
  execFileSync('codesign', ['--sign', '-', nodeBinPath])
}

const seaConfigPath = join(seaDir, 'sea-config.json')
await writeFile(
  seaConfigPath,
  JSON.stringify({
    main: bundlePath,
    output: outputPath,
    executable: nodeBinPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  })
)

console.log(`Building SEA for ${platformKey}...`)
execFileSync(nodeBinPath, ['--build-sea', seaConfigPath], {stdio: 'inherit'})
await chmod(outputPath, 0o755)

console.log(styleText('green', `✓ Created ${outputPath}`))
