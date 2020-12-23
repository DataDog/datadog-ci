import fs from 'fs'
import * as simpleGit from 'simple-git'
import {Writable} from 'stream'
import {URL} from 'url'
import {promisify} from 'util'

import {renderGitError, renderProjectPathNotFoundWarning, renderSourcesNotFoundWarning} from './renderer'

// NewSimpleGit returns a configured SimpleGit.
export const newSimpleGit = (): simpleGit.SimpleGit => {
  const options: simpleGit.SimpleGitOptions = {
    baseDir: process.cwd(),
    binary: 'git',
    // We are invoking at most 3 git commands at the same time.
    maxConcurrentProcesses: 3,
  }

  return simpleGit.gitP(options)
}

// GitRemote returns the remote of the current repository.
export const gitRemote = async (git: simpleGit.SimpleGit): Promise<string> => {
  const remotes = await git.getRemotes(true)
  if (remotes.length === 0) {
    throw new Error('No git remotes available')
  }
  remotes.forEach((remote) => {
    if (remote.name === 'origin') {
      return remote.refs.push
    }
  })

  return remotes[0].refs.push
}

// StripCredentials removes credentials from a remote HTTP url.
export const stripCredentials = (remote: string) => {
  try {
    const url = new URL(remote)
    url.username = ''
    url.password = ''

    return url.toString()
  } catch {
    return remote
  }
}

// GitHash returns the hash of the current repository.
export const gitHash = async (git: simpleGit.SimpleGit): Promise<string> => git.revparse('HEAD')

// GitTrackedFiles returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: simpleGit.SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')

  return files.split(/\r\n|\r|\n/)
}

// TrimStart trims from a set of characters from the start of a string.
export const trimStart = (str: string, chars: string[]) => {
  let start = 0
  const end = str.length
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start
  }

  return start > 0 ? str.substring(start, end) : str
}

// Trim trims from a set of characters from a string.
export const trim = (str: string, chars: string[]) => {
  let start = 0
  let end = str.length
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start
  }
  while (end > start && chars.indexOf(str[end - 1]) >= 0) {
    --end
  }

  return start > 0 || end < str.length ? str.substring(start, end) : str
}

// CleanupSource generates a proper source file path from a sourcemap:
// - Strip a set of hard-coded prefixes ('webpack:///./')
// - Strip the eventual projectPath
// - Removes query parameters
//
// It returns the new source as well as wether are not the specified projectPath was stripped.
export const cleanupSource = (source: string, projectPath: string): [string, boolean] => {
  // Prefixes
  const prefixesToRemove = ['webpack:']
  for (const p of prefixesToRemove) {
    if (source.startsWith(p)) {
      source = source.slice(p.length)
    }
  }
  source = trimStart(source, ['/', '.'])
  // ProjectPath
  projectPath = trim(projectPath, ['/', '.'])
  const projectPathFound = source.substr(0, projectPath.length) === projectPath
  if (projectPathFound) {
    source = source.slice(projectPath.length)
  }
  // Query parmeter
  const pos = source.lastIndexOf('?')
  if (pos > 0) {
    source = source.slice(0, pos)
  }

  return [trimStart(source, ['/', '.']), projectPathFound]
}

// TrackedFilesMap transforms a list of tracked files into a map to look up sources.
export const trackedFilesMap = (trackedFiles: string[]) => {
  const map = new Map<string, string>()
  for (const trackedFile of trackedFiles) {
    const split = trackedFile.split('/')
    for (let i = 0; i < split.length; i++) {
      map.set(split.slice(i, split.length).join('/'), trackedFile)
    }
  }

  return map
}

export interface RepositoryData {
  hash: string
  remote: string
  trackedFiles: Map<string, string>
}

// GitInfos gathers git informations.
export const gitInfos = async (
  git: simpleGit.SimpleGit,
  stdout: Writable,
  repositoryURL: string | undefined
): Promise<RepositoryData | undefined> => {
  // Invoke git commands to retrieve the remote, hash and tracked files.
  // We're using Promise.all instead of Promive.allSettled since we want to fail early if
  // any of the promises fails.
  let remote: string
  let hash: string
  let trackedFiles: string[]
  try {
    if (repositoryURL) {
      ;[hash, trackedFiles] = await Promise.all([gitHash(git), gitTrackedFiles(git)])
      remote = repositoryURL
    } else {
      ;[remote, hash, trackedFiles] = await Promise.all([gitRemote(git), gitHash(git), gitTrackedFiles(git)])
    }
  } catch (e) {
    stdout.write(renderGitError(e))

    return undefined
  }

  const data = {
    hash,
    remote,
    trackedFiles: trackedFilesMap(trackedFiles),
  }

  return data
}

export const filterTrackedFiles = async (
  stdout: Writable,
  srcmapPath: string,
  projectPath: string,
  trackedFiles: Map<string, string>
): Promise<string[] | undefined> => {
  // Retrieve the sources attribute from the sourcemap file.
  const srcmap = await promisify(fs.readFile)(srcmapPath)
  const srcmapObj = JSON.parse(srcmap.toString())
  if (!srcmapObj.sources) {
    return undefined
  }
  const sources = srcmapObj.sources as string[]
  if (!sources || sources.length === 0) {
    return undefined
  }

  // Only keep tracked files that match sources inside the sourcemap.
  const filteredTrackedFiles: string[] = new Array()
  let projectPathFoundInAllSources = false
  for (const source of sources) {
    const [cleanedupSource, projectPathFound] = cleanupSource(source, projectPath)
    if (projectPathFound) {
      projectPathFoundInAllSources = true
    }
    const trackedFile = trackedFiles.get(cleanedupSource)
    if (trackedFile) {
      filteredTrackedFiles.push(trackedFile)
      continue
    }
  }
  if (filteredTrackedFiles.length === 0) {
    stdout.write(renderSourcesNotFoundWarning(srcmapPath))

    return undefined
  }
  if (!projectPathFoundInAllSources) {
    stdout.write(renderProjectPathNotFoundWarning(srcmapPath, projectPath))
  }

  return filteredTrackedFiles
}
