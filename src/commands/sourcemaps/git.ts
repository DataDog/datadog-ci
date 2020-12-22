import simpleGit, {SimpleGit, SimpleGitOptions} from 'simple-git'
import {URL} from 'url'
import fs from 'fs'
import {promisify} from 'util'
import {Writable} from 'stream'
import {renderGitError, renderSourceNotFoundWarning} from './renderer'

// NewSimpleGit returns a configured SimpleGit.
export const NewSimpleGit = (): SimpleGit => {
  const options: SimpleGitOptions = {
    baseDir: process.cwd(),
    binary: 'git',
    maxConcurrentProcesses: 3, // TODO Can probably be higher since 'GitInfos' is invoked concurrently for each sourcemaps.
  }

  // Use 'git' to invoke git commands.
  //
  // Note that when the git process exits with a non-zero status the task will be rejected:
  // https://github.com/steveukx/git-js#exception-handling
  return simpleGit(options)
}

// gitRemote returns the remote of the current repository.
export const gitRemote = async (git: SimpleGit): Promise<string> => {
  const remotes = await git.getRemotes(true)
  if (remotes.length == 0) {
    throw new Error('No git remotes available')
  }
  remotes.forEach((remote) => {
    if (remote.name == 'origin') {
      return remote.refs.push
    }
  })
  return remotes[0].refs.push
}

// stripCredentials removes credentials from a remote HTTP url.
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

// gitHash returns the hash of the current repository.
export const gitHash = async (git: SimpleGit): Promise<string> => {
  return await git.revparse('HEAD')
}

// gitTrackedFiles returns the tracked files of the current repository.
export const gitTrackedFiles = async (git: SimpleGit): Promise<string[]> => {
  const files = await git.raw('ls-files')
  return files.split(/\r\n|\r|\n/)
}

// trimStart trims from a set of characters from the start of a string.
export const trimStart = (str: string, chars: string[]) => {
  let start = 0,
    end = str.length
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start
  }
  return start > 0 ? str.substring(start, end) : str
}

// trim trims from a set of characters from a string.
export const trim = (str: string, chars: string[]) => {
  let start = 0,
    end = str.length
  while (start < end && chars.indexOf(str[start]) >= 0) {
    ++start
  }
  while (end > start && chars.indexOf(str[end - 1]) >= 0) {
    --end
  }
  return start > 0 || end < str.length ? str.substring(start, end) : str
}

// cleanupSource generates a proper source file path from a sourcemap:
// - Strip a set of hard-coded prefixes ('webpack:///./')
// - Strip the eventual projectPath
// - Removes query parameters
export const cleanupSource = (source: string, projectPath: string) => {
  // prefixes
  const prefixesToRemove = ['webpack:']
  for (const p of prefixesToRemove) {
    if (source.startsWith(p)) {
      source = source.slice(p.length)
    }
  }
  source = trimStart(source, ['/', '.'])
  // projectPath
  projectPath = trim(projectPath, ['/', '.'])
  if (source.substr(0, projectPath.length) == projectPath) {
    source = source.slice(projectPath.length)
  }
  // query parmeter
  const pos = source.lastIndexOf('?')
  if (pos > 0) {
    source = source.slice(0, pos)
  }
  return trimStart(source, ['/', '.'])
}

// trackedFilesMap transforms a list of tracked files into a map to look up sources.
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

export interface RepositoryPayload {
  repository_url: string
  hash: string
  files: string[]
}

// GitInfos gathers git informations.
export const GitInfos = async (
  git: SimpleGit,
  stdout: Writable,
  srcmapPath: string,
  repositoryURL: string | undefined
): Promise<RepositoryPayload[] | undefined> => {
  // Retrieve the sources attribute from the sourcemap file.
  const srcmap = await promisify(fs.readFile)(srcmapPath)
  const srcmapObj = JSON.parse(srcmap.toString())
  const sources = srcmapObj['sources'] as string[]
  if (!sources || sources.length == 0) {
    return undefined
  }

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

  // Filter our the tracked files that do not match any source.
  const map = trackedFilesMap(trackedFiles)
  const filteredTrackedFiles: string[] = new Array()
  for (const source of sources) {
    const trackedFile = map.get(source)
    if (trackedFile) {
      filteredTrackedFiles.push(trackedFile)
      continue
    }
    stdout.write(renderSourceNotFoundWarning(source))
  }
  if (filteredTrackedFiles.length == 0) {
    return undefined
  }

  // Prepare the payload.
  var payload: any = {
    repository_url: stripCredentials(remote),
    hash: hash,
    files: filteredTrackedFiles,
  }
  return [payload]
}
