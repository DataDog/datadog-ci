import fs from 'fs'
import * as simpleGit from 'simple-git'
import {Writable} from 'stream'
import {URL} from 'url'
import {promisify} from 'util'
import {renderGitWarning, renderSourcesNotFoundWarning} from './renderer'

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<simpleGit.SimpleGit> => {
  const options = {
    baseDir: '../web-ui/',
    binary: 'git',
    // We are invoking at most 3 git commands at the same time.
    maxConcurrentProcesses: 3,
  }
  try {
    // Attempt to set the baseDir to the root of the repository so the 'git ls-files' command
    // returns the tracked files paths relative to the root of the repository.
    const git = simpleGit.gitP(options)
    const root = await git.revparse('--show-toplevel')
    options.baseDir = root
  } catch {
    // Ignore exception as it will fail if we are not inside a git repository.
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

// Checks if the given tracked file is relevant to the given source path.
// It is used so that we don't send every tracked files to the backend since most won't be of any use.
// The current implementation simply tries to extract out the filename portion of the source and checks
// if its contained in the tracked file.
//
// We are removing any suffix that is after the character '?'. The only reason this is done
// is because we noticed that a non-negligable (~5%) amount of source paths from our customers
// source maps contained query parameters.
// We are assuming that the files may not actually be named with the interrogation mark but that
// it is only an artifact of the build process. The query parameters look random. It looks
// like it may be used as a trick to force a web browser to reload the file content.
// The only side effect of doing that operation is that more tracked files paths may be sent
// alongside the sourcemap which is not a problem.
// Example: webpack:///./src/folder/ui/select.vue?821e
export const trackedFileIsRelated = (source: string, trackedFile: string): boolean => {
  let start = source.lastIndexOf('/')
  if (start === -1) {
    start = 0
  }
  let end = source.lastIndexOf('?')
  if (end === -1) {
    end = source.length
  }

  return trackedFile.endsWith(source.substring(start, end))
}

export interface RepositoryData {
  hash: string
  remote: string
  trackedFilenames: Map<string, string[]>
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
    stdout.write(renderGitWarning(e))

    return undefined
  }

  const trackedFilenames = new Map<string, string[]>();
  for (const f of trackedFiles) {
    const filename = getFilename(f)
    const list = trackedFilenames.get(filename)
    if (list) {
      list.push(f)
      trackedFilenames.set(filename, list)
    } else {
      trackedFilenames.set(filename, new Array<string>(f))
    }
  }

  const data = {
    hash,
    remote,
    trackedFilenames,
  }

  return data
}

const getFilename = (s: string): string => {
  let start = s.lastIndexOf('/')
  if (start === -1) {
    start = 0
  }
  let end = s.lastIndexOf('?')
  if (end === -1 || end <= start) {
    end = s.length
  }
  return s.substring(start, end)
}

// Looks up the source paths declared in the sourcemap and try to filter out unrelated tracked files.
// The list of filtered tracked files is returned.
export const filterTrackedFiles = async (
  stdout: Writable,
  srcmapPath: string,
  trackedFilenames: Map<string, string[]>
): Promise<string[] | undefined> => {
  // Retrieve the sources attribute from the sourcemap file.
  const initialTime = Date.now()
  const srcmap = await promisify(fs.readFile)(srcmapPath)
  const srcmapObj = JSON.parse(srcmap.toString())
  if (!srcmapObj.sources) {
    return undefined
  }
  const sources = srcmapObj.sources as string[]
  if (!sources || sources.length === 0) {
    return undefined
  }
  const totalTime = (Date.now() - initialTime)
  stdout.write(`json.Parse took ${totalTime}ms (${srcmapPath})\n`)

  const initialTime2 = Date.now()
  // Only keep tracked files that may be related to the sources declared in the sourcemap
  let filtered: string[] = new Array()
  let filenameAlreadyMatched = new Map<string, Boolean>();
  for (const source of sources) {
    const filename = getFilename(source)
    if (filenameAlreadyMatched.has(filename)) {
      continue
    }
    filenameAlreadyMatched.set(filename, true)
    const trackedFiles = trackedFilenames.get(filename)
    if (trackedFiles) {
      filtered = filtered.concat(trackedFiles)
    }
  }

  const totalTime2 = (Date.now() - initialTime2)
  stdout.write(`filtering took ${totalTime2}ms (${srcmapPath})\n`)

  if (filtered.length === 0) {
    stdout.write(renderSourcesNotFoundWarning(srcmapPath))

    return undefined
  }

  return filtered
}
