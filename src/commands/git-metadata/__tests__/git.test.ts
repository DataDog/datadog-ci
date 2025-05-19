import fs from 'fs'

import * as simpleGit from 'simple-git'
import path from 'upath'

import {getCommitInfo, newSimpleGit, stripCredentials, parseGitDiff} from '../git'

interface MockConfig {
  hash?: string
  remotes?: any[]
  trackedFiles?: string[]
}

const createMockSimpleGit = (conf: MockConfig) => ({
  // eslint-disable-next-line no-null/no-null
  getConfig: (_: string) => ({value: null}),
  getRemotes: async (_: boolean) => {
    if (conf.remotes === undefined) {
      throw Error('Unexpected call to getRemotes')
    }

    return conf.remotes
  },
  raw: async (command: string) => {
    if (command === 'ls-files' && conf.trackedFiles !== undefined) {
      return conf.trackedFiles.join('\n') + '\n'
    }
    throw Error(`Unexpected call to raw(${command})`)
  },
  revparse: async (_: string) => {
    if (conf.hash === undefined) {
      throw Error('Unexpected call to revparse')
    }

    return conf.hash
  },
})

describe('git', () => {
  describe('stripCredentials: git protocol', () => {
    test('should return the same value', () => {
      const input = 'git@github.com:user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })
  })
  describe('stripCredentials: nothing to remove', () => {
    test('should return the same value', () => {
      const input = 'https://gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })
  })
  describe('stripCredentials: user:pwd', () => {
    test('should return without credentials', () => {
      const input = 'https://token:[MASKED]@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })
  })
  describe('stripCredentials: token', () => {
    test('should return without credentials', () => {
      const input = 'https://token@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })
  })
  describe('getCommitInfo', () => {
    test('should return commit info from simple git', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        remotes: [{name: 'first', refs: {push: 'https://git-repo'}}],
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock)

      expect(commitInfo).toBeDefined()
      expect(commitInfo.hash).toBe('abcd')
      expect(commitInfo.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo.remote).toBe('https://git-repo/')
    })

    test('should return commit info with overridden repo name', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock, 'https://overridden')

      expect(commitInfo).toBeDefined()
      expect(commitInfo.hash).toBe('abcd')
      expect(commitInfo.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo.remote).toBe('https://overridden')
    })
  })

  describe('newSimpleGit', () => {
    test('should throw an error if git is not installed', async () => {
      jest.spyOn(simpleGit, 'simpleGit').mockImplementation(() => {
        throw Error('gitp error')
      })
      await expect(newSimpleGit()).rejects.toThrow('gitp error')
    })

    test('should throw an error if revparse throws an error', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'simpleGit').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockImplementation(async () => {
        throw Error('revparse error')
      })

      await expect(newSimpleGit()).rejects.toThrow('revparse error')
    })

    test('should not throw any errors', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'simpleGit').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockResolvedValue('1234')

      await expect(newSimpleGit()).resolves.not.toThrow()
    })
  })
})

describe('parseGitDiff – tree structure', () => {
  const fixtures = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

  test('modification of a single file', () => {
    const diff = fixtures('modify_single_file.diff')
    const tree = parseGitDiff(diff)

    const calc = tree['src/Calculator.java']
    expect(decode(calc.addedLines)).toEqual(new Set([10, 11]))
    expect(decode(calc.removedLines)).toEqual(new Set([10, 11]))
  })

  test('file add & delete in one patch', () => {
    const diff = fixtures('add_delete.diff')
    const tree = parseGitDiff(diff)

    // deleted README.md
    const readme = tree['README.md']
    expect(readme.addedLines).toBe('')
    expect(decode(readme.removedLines)).toEqual(new Set([1, 2]))

    // new Utils.java
    const utils = tree['src/Utils.java']
    expect(decode(utils.addedLines)).toEqual(new Set([1, 2, 3, 4]))
    expect(utils.removedLines).toBe('')
  })
})

const decode = (base64: string | undefined): Set<number> => {
  if (!base64) {
    return new Set()
  }
  const bytes = Buffer.from(base64, 'base64')
  const out = new Set<number>()
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    for (let bit = 0; bit < 8; bit++) {
      // eslint-disable-next-line no-bitwise
      if (byte & (1 << bit)) {
        out.add(i * 8 + bit + 1) // 1-based
      }
    }
  }

  return out
}
