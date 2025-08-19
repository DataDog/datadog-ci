import fs from 'fs'

import * as simpleGit from 'simple-git'

import {gitHash, gitRemote, gitTrackedFiles} from './get-git-data'

// Returns a configured SimpleGit.
export const newSimpleGit = async (): Promise<simpleGit.SimpleGit> => {
  const options = {
    baseDir: process.cwd(),
    binary: 'git',
    // We are invoking at most 3 git commands at the same time.
    maxConcurrentProcesses: 3,
  }
  try {
    // Attempt to set the baseDir to the root of the repository so the 'git ls-files' command
    // returns the tracked files paths relative to the root of the repository.
    const git = simpleGit.simpleGit(options)
    const root = await git.revparse('--show-toplevel')
    options.baseDir = root
  } catch {
    // Ignore exception as it will fail if we are not inside a git repository.
  }

  return simpleGit.simpleGit(options)
}

export interface RepositoryData {
  hash: string
  remote: string
  trackedFilesMatcher: TrackedFilesMatcher
}

// Returns the current hash and remote as well as a TrackedFilesMatcher.
//
// To obtain the list of tracked files paths tied to a specific sourcemap, invoke the 'matchSourcemap' method.
export const getRepositoryData = async (
  git: simpleGit.SimpleGit,
  repositoryURL: string | undefined
): Promise<RepositoryData> => {
  // Invoke git commands to retrieve the remote, hash and tracked files.
  // We're using Promise.all instead of Promise.allSettled since we want to fail early if
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
    throw e
  }

  const data = {
    hash,
    remote,
    trackedFilesMatcher: new TrackedFilesMatcher(trackedFiles),
  }

  return data
}

// TrackedFilesMatcher can compute the list of tracked files related to a particular sourcemap.
// The current implementation simply returns all tracked files whose filename is found inside
// the sourcemap 'sources' field.
// It is used so that we don't send every tracked files to the backend since most won't be of any use
// for a particular sourcemap.
export class TrackedFilesMatcher {
  // A map with tracked filenames as key and the related tracked file paths as value.
  private trackedFilenames: Map<string, string[]>

  constructor(trackedFiles: string[]) {
    this.trackedFilenames = new Map<string, string[]>()
    for (const f of trackedFiles) {
      const filename = this.getFilename(f)
      const list = this.trackedFilenames.get(filename)
      if (list) {
        list.push(f)
      } else {
        this.trackedFilenames.set(filename, new Array<string>(f))
      }
    }
  }

  // Looks up the sources declared in the sourcemap and return a list of related tracked files.
  public matchSourcemap(srcmapPath: string, onSourcesNotFound: () => void): string[] | undefined {
    const buff = fs.readFileSync(srcmapPath, 'utf8')
    const srcmapObj = JSON.parse(buff)
    if (!srcmapObj.sources) {
      return undefined
    }
    const sources = srcmapObj.sources as string[]
    if (!sources || sources.length === 0) {
      return undefined
    }
    const filtered = this.matchSources(sources)
    if (filtered.length === 0) {
      onSourcesNotFound()

      return undefined
    }

    return filtered
  }

  public matchSources(sources: string[]): string[] {
    let filtered: string[] = []
    const filenameAlreadyMatched = new Set<string>()
    for (const source of sources) {
      const filename = this.getFilename(source)
      if (filenameAlreadyMatched.has(filename)) {
        continue
      }
      filenameAlreadyMatched.add(filename)
      const trackedFiles = this.trackedFilenames.get(filename)
      if (trackedFiles) {
        filtered = filtered.concat(trackedFiles)
      }
    }

    return filtered
  }

  // Return a list of all tracked files
  public rawTrackedFilesList() {
    let rawList: string[] = []
    this.trackedFilenames.forEach((value) => {
      rawList = rawList.concat(value)
    })

    return rawList
  }

  // Extract the filename from a path.
  //
  // We are removing any suffix that is after the character '?'. The only reason this is done
  // is because we noticed that a non-negligible (~5%) amount of source paths from our customers
  // source maps contained query parameters.
  // We are assuming that the files may not actually be named with the interrogation mark but that
  // it is only an artifact of the build process. The query parameters look random. It looks
  // like it may be used as a trick to force a web browser to reload the file content.
  // The only side effect of doing that operation is that more tracked files paths may be sent
  // alongside the sourcemap which is not a problem.
  // Example: webpack:///./src/folder/ui/select.vue?821e
  private getFilename(s: string): string {
    let start = s.lastIndexOf('/')
    if (start === -1) {
      start = 0
    } else {
      start++
    }
    let end = s.lastIndexOf('?')
    if (end === -1 || end <= start) {
      end = s.length
    }

    return s.substring(start, end)
  }
}
