import type {SimpleGit} from 'simple-git'

import {isGitEnvKey} from '@simple-git/argv-parser'
import upath from 'upath'

import {DEFAULT_GIT_OPTIONS} from './default-options'

// Keep relative repository paths tied to the invocation directory when a client changes baseDir.
export const withGitRepositoryEnvironment = (git: SimpleGit, cwd: string): SimpleGit => {
  const hasRelativePath = DEFAULT_GIT_OPTIONS.allowEnvironment.some((key) => {
    const value = process.env[key]

    return value && !upath.isAbsolute(value)
  })
  if (!hasRelativePath) {
    return git
  }

  // Explicit .env() values reject guarded keys, whereas ambient values are silently stripped.
  // Match simple-git's filtering before supplying a copy of the inherited environment.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      const normalizedKey = key.toLowerCase().trim()

      return (
        DEFAULT_GIT_OPTIONS.allowEnvironment.includes(key) ||
        (!normalizedKey.startsWith('git_') && !isGitEnvKey(normalizedKey))
      )
    })
  )
  for (const key of DEFAULT_GIT_OPTIONS.allowEnvironment) {
    if (env[key]) {
      env[key] = upath.resolve(cwd, env[key])
    }
  }

  return git.env(env)
}
