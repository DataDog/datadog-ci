import childProcess from 'child_process'
import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {GIT_BRANCH, GIT_COMMIT_AUTHOR_NAME, GIT_COMMIT_MESSAGE, GIT_SHA} from '../../tags'

import {getGitMetadata} from '../format-git-span-data'

describe('stored checkout metadata', () => {
  test.each([false, true])('reads a commit without its parent objects (detached: %s)', async (detached) => {
    const directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'git-commit-metadata-'))
    const originalEnv = process.env
    const env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) => !key.startsWith('GIT_')))
    const sourceSha = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {env, encoding: 'utf8'}).trim()
    // Copy an existing commit byte for byte; no fixture commit needs to be authored or signed.
    const commit = childProcess.execFileSync('git', ['cat-file', 'commit', sourceSha], {env})
    const text = commit.toString('utf8')
    const parent = /^parent ([0-9a-f]+)$/m.exec(text)?.[1]
    expect(parent).toBeDefined()

    try {
      childProcess.execFileSync('git', ['init', '--quiet', directory], {env})
      const copiedSha = childProcess
        .execFileSync('git', ['hash-object', '-w', '-t', 'commit', '--stdin'], {
          cwd: directory,
          env,
          input: commit,
          encoding: 'utf8',
        })
        .trim()
      expect(copiedSha).toBe(sourceSha)
      childProcess.execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/metadata-fixture'], {cwd: directory, env})
      childProcess.execFileSync('git', ['update-ref', 'HEAD', sourceSha], {cwd: directory, env})
      if (detached) {
        fs.writeFileSync(upath.join(directory, '.git/HEAD'), sourceSha + '\n')
      }
      const missingParent = childProcess.spawnSync('git', ['cat-file', '-e', `${parent}^{commit}`], {
        cwd: directory,
        env,
      })
      expect(missingParent.status).not.toBe(0)

      process.env = env
      jest.spyOn(process, 'cwd').mockReturnValue(directory)
      const spawn = childProcess.spawn
      jest
        .spyOn(childProcess, 'spawn')
        .mockImplementation((command, args, options) =>
          spawn(command, args, {...options, env: options?.env ?? process.env})
        )
      const metadata = await getGitMetadata()
      expect(metadata[GIT_SHA]).toBe(sourceSha)
      expect(metadata[GIT_COMMIT_MESSAGE]).toBe(text.split('\n\n')[1].split('\n')[0])
      expect(metadata[GIT_COMMIT_AUTHOR_NAME]).toBe(/^author (.*) <[^>]*> /m.exec(text)?.[1])
      expect(metadata[GIT_BRANCH]).toBe(detached ? undefined : 'metadata-fixture')
    } finally {
      process.env = originalEnv
      jest.restoreAllMocks()
      fs.rmSync(directory, {recursive: true, force: true})
    }
  })
})
