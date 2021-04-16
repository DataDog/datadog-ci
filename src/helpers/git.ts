import {execSync} from 'child_process'

import {GIT_BRANCH, GIT_REPOSITORY_URL, GIT_SHA} from './tags'

const sanitizedExec = (cmd: string, options = {}) => {
  try {
    return execSync(cmd, options)
      .toString()
      .replace(/(\r\n|\n|\r)/gm, '')
  } catch (e) {
    return ''
  }
}

export const getGitMetadata = () => {
  // With stdio: 'pipe', errors in this command will not be output to the parent process,
  // so if `git` is not present in the env, we won't show a warning to the user
  const execOptions = {stdio: 'pipe'}

  return {
    [GIT_REPOSITORY_URL]: sanitizedExec('git ls-remote --get-url', execOptions),
    [GIT_BRANCH]: sanitizedExec('git rev-parse --abbrev-ref HEAD', execOptions),
    [GIT_SHA]: sanitizedExec('git rev-parse HEAD', execOptions),
  }
}
