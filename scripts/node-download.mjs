import {execFileSync} from 'node:child_process'
import {chmodSync, createWriteStream} from 'node:fs'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'

export const NODE_VERSION = 'v26.1.0'
export const NODE_DOWNLOAD_BASE_URL = 'https://nodejs.org/dist'
export const PKG_FETCH_RELEASE = 'https://github.com/Drarig29/pkg-fetch/releases/download/v1.3'

export const downloadToFile = async (url, destPath) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  await pipeline(response.body, createWriteStream(destPath))
}

export const getPkgFetchBinaryName = (platformKey) => `node-${NODE_VERSION}-${platformKey}`

const getOfficialNodeDistribution = () => {
  if (process.platform === 'win32') {
    const arch = {arm64: 'arm64', x64: 'x64'}[process.arch]
    if (!arch) {
      throw new Error(`Unsupported architecture for Node.js download on Windows: ${process.arch}`)
    }

    return {archiveExtension: 'zip', binaryPath: 'node.exe', platform: 'win', arch}
  }

  if (process.platform === 'darwin') {
    const arch = {arm64: 'arm64', x64: 'x64'}[process.arch]
    if (!arch) {
      throw new Error(`Unsupported architecture for Node.js download on macOS: ${process.arch}`)
    }

    return {archiveExtension: 'tar.gz', binaryPath: path.join('bin', 'node'), platform: 'darwin', arch}
  }

  if (process.platform === 'linux') {
    const arch = {arm64: 'arm64', x64: 'x64'}[process.arch]
    if (!arch) {
      throw new Error(`Unsupported architecture for Node.js download on Linux: ${process.arch}`)
    }

    return {archiveExtension: 'tar.xz', binaryPath: path.join('bin', 'node'), platform: 'linux', arch}
  }

  throw new Error(`Unsupported platform for Node.js download: ${process.platform}`)
}

const extractWithPowershell = (archivePath, destinationPath) => {
  const command = `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destinationPath}' -Force`
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
  let lastError

  try {
    execFileSync('pwsh', args, {stdio: 'inherit'})

    return
  } catch (error) {
    lastError = error
  }

  throw lastError
}

const extractNodeArchive = (archivePath, destinationPath) => {
  try {
    execFileSync('tar', ['-xf', archivePath, '-C', destinationPath], {stdio: 'inherit'})

    return
  } catch (error) {
    if (!archivePath.endsWith('.zip') || process.platform !== 'win32') {
      throw error
    }
  }

  extractWithPowershell(archivePath, destinationPath)
}

export const getOfficialNodeDownload = () => {
  const {archiveExtension, arch, binaryPath, platform} = getOfficialNodeDistribution()
  const archiveBaseName = `node-${NODE_VERSION}-${platform}-${arch}`
  const archiveName = `${archiveBaseName}.${archiveExtension}`

  return {
    archiveBaseName,
    archiveName,
    binaryPath,
    url: `${NODE_DOWNLOAD_BASE_URL}/${NODE_VERSION}/${archiveName}`,
  }
}

export const downloadOfficialNodeBinary = async (destinationPath) => {
  const {archiveBaseName, archiveName, binaryPath, url} = getOfficialNodeDownload()
  const archivePath = path.join(destinationPath, archiveName)

  await downloadToFile(url, archivePath)
  extractNodeArchive(archivePath, destinationPath)

  const nodePath = path.join(destinationPath, archiveBaseName, binaryPath)
  if (process.platform !== 'win32') {
    chmodSync(nodePath, 0o755)
  }

  return nodePath
}
