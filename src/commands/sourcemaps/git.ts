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

// GitInfo returns a stringified json containing git info.
//
// TODO sourcemap sources / tracked files matching logic.
// TODO handle thrown exceptions (explicit and from simpleGit if exit code > 0)
// TODO output a proper error message if the --git-disable is not used but an error occurs.
// TODO handle --repository-url flag overwrite.
// TODO handle --git-disable flag.
// TODO optional: attempt to remove query parameters from sourcemap sources
// TODO optional: support a config file instead of just flags.
export const GitInfos = async(): Promise<string|undefined> => {

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
