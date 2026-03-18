import * as simpleGit from 'simple-git'

import {isCI} from '../ci'

declare const concurrencyBrand: unique symbol

type ConcurrencyTuple<N extends number, T extends 0[] = []> = number extends N
  ? 0[]
  : T['length'] extends N
    ? T
    : ConcurrencyTuple<N, [...T, 0]>

export type GitClient<MinConcurrency extends number = 0> = simpleGit.SimpleGit & {
  readonly [concurrencyBrand]: readonly [...ConcurrencyTuple<MinConcurrency>, ...0[]]
}

export const newSimpleGit = async <N extends number = 1>(
  maxConcurrentProcesses?: N,
  baseDir?: string
): Promise<GitClient<N>> => {
  const concurrency = maxConcurrentProcesses ?? 1
  const currentDir = baseDir ?? process.cwd()
  const options = {
    baseDir: currentDir,
    binary: 'git',
    maxConcurrentProcesses: concurrency,
  }

  const git = simpleGit.simpleGit(options)

  const isDocker = (await import('is-docker')).default

  if (isCI() || isDocker()) {
    try {
      await git.addConfig('safe.directory', currentDir, true, simpleGit.GitConfigScope.global)
    } catch (e) {
      // Ignore the error
    }
  }

  try {
    const root = await git.revparse('--show-toplevel')
    options.baseDir = root
  } catch {
    // Ignore exception as it will fail if we are not inside a git repository.
  }

  return simpleGit.simpleGit(options) as unknown as GitClient<N>
}
