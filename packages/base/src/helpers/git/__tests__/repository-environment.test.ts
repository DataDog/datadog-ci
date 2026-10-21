import childProcess from 'child_process'
import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {newSimpleGit} from '../format-git-sourcemaps-data'

describe('Git repository environment', () => {
  test('discovers the repository and tracked files through inherited GIT_DIR and GIT_WORK_TREE', async () => {
    const directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-git-environment-'))
    const workTree = upath.join(directory, 'work-tree')
    const gitDir = upath.join(directory, 'git-dir')
    const originalEnv = process.env

    try {
      // Isolate the fixture from Git environment variables inherited from CI.
      const env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith('GIT_')))
      childProcess.execFileSync('git', ['init', '--quiet', workTree], {env})
      fs.renameSync(upath.join(workTree, '.git'), gitDir)
      fs.writeFileSync(upath.join(workTree, 'tracked.txt'), 'tracked file\n')

      const repositoryEnv = {...env, GIT_DIR: gitDir, GIT_WORK_TREE: workTree}
      process.env = repositoryEnv
      childProcess.execFileSync('git', ['add', 'tracked.txt'], {cwd: workTree, env: repositoryEnv})
      const root = childProcess
        .execFileSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: workTree,
          env: repositoryEnv,
          encoding: 'utf8',
        })
        .trim()
      jest.spyOn(process, 'cwd').mockReturnValue(workTree)

      // Native spawning otherwise inherits Node's environment rather than Jest's isolated process.env.
      const spawn = childProcess.spawn
      jest
        .spyOn(childProcess, 'spawn')
        .mockImplementation((command, args, options) =>
          spawn(command, args, {...options, env: options?.env ?? process.env})
        )

      const git = await newSimpleGit()

      await expect(git.revparse('--show-toplevel')).resolves.toBe(root)
      await expect(git.raw(['ls-files'])).resolves.toBe('tracked.txt\n')
    } finally {
      process.env = originalEnv
      jest.restoreAllMocks()
      fs.rmSync(directory, {recursive: true, force: true})
    }
  })
})
