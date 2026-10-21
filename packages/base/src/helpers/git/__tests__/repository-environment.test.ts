import childProcess from 'child_process'
import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {newSimpleGit as newGitMetadataSimpleGit} from '../../../commands/git-metadata/git'

import {GIT_COMMIT_MESSAGE, GIT_REPOSITORY_URL, GIT_SHA} from '../../tags'

import {newSimpleGit} from '../format-git-sourcemaps-data'
import {getGitMetadata} from '../format-git-span-data'

describe('Git repository environment', () => {
  test.each([
    ['sourcemaps (absolute paths)', newSimpleGit, false],
    ['sourcemaps (relative paths)', newSimpleGit, true],
    ['git-metadata (absolute paths)', newGitMetadataSimpleGit, false],
    ['git-metadata (relative paths)', newGitMetadataSimpleGit, true],
  ])(
    '%s discovers the repository and tracked files through inherited GIT_DIR and GIT_WORK_TREE',
    async (_, createGit, relativePaths) => {
      const directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'datadog-ci-git-environment-'))
      const workTree = upath.join(directory, 'work-tree')
      const gitDir = upath.join(directory, 'git-dir')
      const cwd = upath.join(workTree, 'nested')
      const originalEnv = process.env

      try {
        // Isolate the fixture from Git environment variables inherited from CI.
        const env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith('GIT_')))
        childProcess.execFileSync('git', ['init', '--quiet', workTree], {env})
        fs.renameSync(upath.join(workTree, '.git'), gitDir)
        fs.mkdirSync(cwd)
        fs.writeFileSync(upath.join(workTree, 'tracked.txt'), 'tracked file\n')

        const repositoryEnv = {...env, HOME: directory, GIT_DIR: gitDir, GIT_WORK_TREE: workTree}
        process.env = repositoryEnv
        childProcess.execFileSync('git', ['add', 'tracked.txt'], {cwd: workTree, env: repositoryEnv})
        childProcess.execFileSync(
          'git',
          ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'Test commit'],
          {cwd: workTree, env: repositoryEnv}
        )
        const repositoryURL = 'https://github.com/example/repository.git'
        childProcess.execFileSync('git', ['remote', 'add', 'origin', repositoryURL], {
          cwd: workTree,
          env: repositoryEnv,
        })
        const hash = childProcess
          .execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workTree, env: repositoryEnv, encoding: 'utf8'})
          .trim()
        const root = childProcess
          .execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: workTree,
            env: repositoryEnv,
            encoding: 'utf8',
          })
          .trim()
        const gitEnvironment = {
          GIT_DIR: relativePaths ? upath.relative(cwd, gitDir) : gitDir,
          GIT_WORK_TREE: relativePaths ? '..' : workTree,
        }
        process.env = {
          ...repositoryEnv,
          ...gitEnvironment,
          // Other guarded variables must still be stripped, including non-GIT_ keys.
          GIT_CONFIG_COUNT: 'invalid',
          EDITOR: 'unused-editor',
        }
        jest.spyOn(process, 'cwd').mockReturnValue(cwd)

        // Native spawning otherwise inherits Node's environment rather than Jest's isolated process.env.
        const spawn = childProcess.spawn
        jest
          .spyOn(childProcess, 'spawn')
          .mockImplementation((command, args, options) =>
            spawn(command, args, {...options, env: options?.env ?? process.env})
          )

        const git = await createGit()

        await expect(git.revparse('--show-toplevel')).resolves.toBe(root)
        await expect(git.raw(['ls-files'])).resolves.toBe('tracked.txt\n')
        await expect(getGitMetadata()).resolves.toMatchObject({
          [GIT_SHA]: hash,
          [GIT_REPOSITORY_URL]: repositoryURL,
          [GIT_COMMIT_MESSAGE]: 'Test commit',
        })
        expect(process.env.GIT_DIR).toBe(gitEnvironment.GIT_DIR)
        expect(process.env.GIT_WORK_TREE).toBe(gitEnvironment.GIT_WORK_TREE)
      } finally {
        process.env = originalEnv
        jest.restoreAllMocks()
        fs.rmSync(directory, {recursive: true, force: true})
      }
    }
  )
})
