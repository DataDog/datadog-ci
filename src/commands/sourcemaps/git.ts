import fs from 'fs'
import * as simpleGit from 'simple-git'
import {Writable} from 'stream'
import {URL} from 'url'
import {promisify} from 'util'

import {renderGitError, renderProjectPathNotFoundWarning, renderSourcesNotFoundWarning} from './renderer'

// Returns a configured SimpleGit.
export const newSimpleGit = (): simpleGit.SimpleGit => {
  const options: simpleGit.SimpleGitOptions = {
    baseDir: process.cwd(),
    binary: 'git',
    // We are invoking at most 3 git commands at the same time.
    maxConcurrentProcesses: 3,
  }

  return simpleGit.gitP(options)
}

// Returns the remote of the current repository.
export const gitRemote = async (git: simpleGit.SimpleGit): Promise<string> => {
  const remotes = await git.getRemotes(true)
  if (remotes.length === 0) {
    throw new Error('No git remotes available')
  }

  for (const remote of remotes) {
    // We're trying to pick the remote called with the default git name 'origin'.
    if (remote.name === 'origin') {
      return remote.refs.push
    }
  }

  // Falling back to picking the first remote in the list if 'origin' is not found.
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

// Returns the hash of the current repository.
const gitHash = async (git: simpleGit.SimpleGit): Promise<string> => git.revparse('HEAD')

// Returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: simpleGit.SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')

  return files.split(/\r\n|\r|\n/)
}

// Trims from a set of characters from the start of a string.
const trimStart = (str: string, chars: string[]) => {
  let start = 0
  const end = str.length
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start
  }

  return start > 0 ? str.substring(start, end) : str
}

// Trims from a set of characters from a string.
const trim = (str: string, chars: string[]) => {
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

// Generates a proper source file path from a sourcemap:
//
// - Strip a set of hard-coded prefixes ('webpack:///./')
//
// - Strip the eventual projectPath
//
// - Removes query parameters:
//   We are removing any suffix that is after the character '?'. The only reason this is done
//   is because we noticed that a non-negligable (~5%) amount of source paths from our customers
//   source maps contained query parameters.
//   We are assuming that the files are not actually named with the interrogation mark but that
//   it is only an artifact of the build process. The query parameters look random. It looks
//   like it may be used as a trick to force a web browser to reload the file content.
//   Example: webpack:///./src/folder/ui/Select.vue?820e
//
// It returns the new source as well as whether or not the specified projectPath was stripped.
//
// For example, the following source path:
// webpack:///./project/folder1/folder2/src.js?abc123
//
// Will be cleaned up into 'project/folder1/folder2/src.js'.
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

// Creates a lookup map from source paths to tracked file paths.
// The tracked file paths will be split into as many keys as there is folders in the path (+ the filename).
// It allows to do an exact match when looking up a source path in the tracked files, which will be enough
// in most cases.
// It also allows to make an 'educated guess' / 'best-effort' match on the off-chance the source path we are
// trying to find does not contain the whole tracked file path. It's an edge case but can easily be handled
// using this method.
//
// To perform a match simply lookup the source path in the map keys. The value returned is the complete tracked
// file path.
//
// For example the following tracked file path:
// project/folder1/folder2/src.js
//
// Will be matched by any of:
// project/folder1/folder2/src.js
// folder1/folder2/src.js
// folder2/src.js
// src.js
//
export const trackedFilesMap = (trackedFiles: string[]): Map<string, string> => {
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

// Gathers repository data.
// It returns the current hash and remote as well as a map of tracked files.
// Look for the trackedFilesMap function for more details.
//
// To obtain the list of tracked files path tied to specific sourcemaps, first invoke 'getRepositoryData',
// then for each sourcemap invoke the 'filterTrackedFiles' function.
export const getRepositoryData = async (
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

// Looks up the source paths declared in the sourcemap and try to match each of them
// with a tracked file. The list of matching tracked files is returned.
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
