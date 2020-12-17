import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';

const options: SimpleGitOptions = {
   baseDir: process.cwd(),
   binary: 'git',
   maxConcurrentProcesses: 6,
};

// Use 'git' to invoke git commands.
//
// Note that when the git process exits with a non-zero status the task will be rejected:
// https://github.com/steveukx/git-js#exception-handling
const git: SimpleGit = simpleGit(options);

export const GitRemote = async(): Promise<string> => {
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

export const GitHash = async(): Promise<string> => {
    return await git.revparse('HEAD')
}

export const GitTrackedFiles = async(): Promise<string[]> => {
    const files = await git.raw('ls-files')
    return files.split(/\r\n|\r|\n/)
}
