import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git'
import { URL } from 'url'

const options: SimpleGitOptions = {
   baseDir: process.cwd(),
   binary: 'git',

   // TODO Can probably be higher since 'GitInfos' is invoked concurrently for each sourcemaps.
   maxConcurrentProcesses: 3,
}

// Use 'git' to invoke git commands.
//
// Note that when the git process exits with a non-zero status the task will be rejected:
// https://github.com/steveukx/git-js#exception-handling
const git: SimpleGit = simpleGit(options)

export const gitRemote = async(): Promise<string> => {
    const remotes = await git.getRemotes(true)
    if (remotes.length==0) {
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

export const gitHash = async(): Promise<string> => {
    return await git.revparse('HEAD')
}

export const gitTrackedFiles = async(): Promise<string[]> => {
    const files = await git.raw('ls-files')
    return files.split(/\r\n|\r|\n/)
}

export const trimStart = (str: string, chars: string[]) => {
    let start = 0, end = str.length
    while (start < end && chars.indexOf(str[start]) >= 0) {
        ++start;
    }
    return (start > 0) ? str.substring(start, end) : str;
}

export const trim = (str: string, chars: string[]) => {
    let start = 0, end = str.length
    while (start < end && chars.indexOf(str[start]) >= 0) {
        ++start;
    }
    while(end > start && chars.indexOf(str[end - 1]) >= 0) {
        --end;
    }
    return (start > 0 || end < str.length) ? str.substring(start, end) : str;
}

// cleanupSource generates a proper source file path from a sourcemap:
// - Strip the eventual projectPath
// - Strip a set of hard-coded prefixes ('webpack:///./')
// - Removes query parameters
export const cleanupSource = (source: string, projectPath: string) => {
    // prefixes
    const prefixesToRemove = ['webpack:']
    for (let p of prefixesToRemove) {
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
    const pos = source.lastIndexOf("?")
    if (pos > 0) {
        source = source.slice(0, pos)
    }
    return trimStart(source, ['/', '.'])
}

// trackedFilesMap transforms a list of tracked files into a map to look up sources.
export const trackedFilesMap = (trackedFiles: string[]) => {
    const map = new Map<string, string>();
    for (const trackedFile of trackedFiles) {
        const split = trackedFile.split("/")
        for (let i = 0; i < split.length; i++) {
            map.set(split.slice(i, split.length).join("/"), trackedFile)
        }
    }
    return map
}

// GitInfo returns a stringified json containing git info.
//
// TODO handle thrown exceptions (explicit and from simpleGit if exit code > 0)
// TODO output a proper error message if an error occurs.
// TODO handle --repository-url flag overwrite.
// TODO handle --git-disable flag.
// TODO optional: support a config file instead of just flags.
// TODO make sure it works on windows
export const GitInfos = async(srcmapPath: string): Promise<string|undefined> => {

    // We're using Promise.all instead of Promive.allSettled since we want to fail early if 
    // any of the promises fails.
    let [remote, hash, trackedFiles] = await Promise.all([gitRemote(), gitHash(), gitTrackedFiles()])

    var payload: any = {
        repository_url: stripCredentials(remote),
        hash: hash,
        files: trackedFiles,
    }

    let arr: any[] = new Array()
    arr.push(payload)
    return JSON.stringify(arr)
}
