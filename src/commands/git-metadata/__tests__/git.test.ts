import * as simpleGit from 'simple-git'

import {getCommitInfo, gitRemote, newSimpleGit, normalizeRemote, stripCredentials} from '../git'

interface MockConfig {
  hash?: string
  remotes?: any[]
  trackedFiles?: string[]
}

const createMockSimpleGit = (conf: MockConfig) => ({
  getRemotes: async (_: boolean) => {
    if (conf.remotes === undefined) {
      throw Error('Unexpected call to getRemotes')
    }

    return conf.remotes!
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

    return conf.hash!
  },
})

describe('git', () => {
  describe('gitRemote', () => {
    test('should choose the remote named origin', async () => {
      const mock = createMockSimpleGit({
        remotes: [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'origin', refs: {push: 'remote2'}},
        ],
      }) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote2')
    })
    test('should choose the first remote', async () => {
      const mock = createMockSimpleGit({
        remotes: [
          {name: 'first', refs: {push: 'remote1'}},
          {name: 'second', refs: {push: 'remote2'}},
        ],
      }) as any
      const remote = await gitRemote(mock)

      expect(remote).toBe('remote1')
    })
  })

  describe('stripCredentials', () => {
    test('git protocol', () => {
      const input = 'git@github.com:user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })

    test('nothing to remove', () => {
      const input = 'https://gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe(input)
    })

    test('user:pwd', () => {
      const input = 'https://token:[MASKED]@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })

    test('token', () => {
      const input = 'https://token@gitlab.com/user/project.git'

      expect(stripCredentials(input)).toBe('https://gitlab.com/user/project.git')
    })
  })

  describe('normalizeRemote', () => {
    test('ssh://alex@host.xz:1234/path/to/repo.git', () => {
      const input = 'ssh://alex@host.xz:1234/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/path/to/repo')
    })
    test('git://host.xz:1234/path/to/repo.git', () => {
      const input = 'git://host.xz:1234/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/path/to/repo')
    })
    test('https://host.xz:1234/path/to/repo.git', () => {
      const input = 'https://host.xz:1234/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/path/to/repo')
    })
    test('ftp://host.xz:1234/path/to/repo.git', () => {
      const input = 'ftp://host.xz:1234/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/path/to/repo')
    })
    test('alex@host.xz:path/to/repo.git', () => {
      const input = 'alex@host.xz:path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/path/to/repo')
    })
    test('ssh://alex@host.xz:1234/~alex/path/to/repo.git', () => {
      const input = 'ssh://alex@host.xz:1234/~alex/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/~alex/path/to/repo')
    })
    test('git://host.xz:1234/~alex/path/to/repo.git', () => {
      const input = 'git://host.xz:1234/~alex/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/~alex/path/to/repo')
    })
    test('https://gitlab.awspro.pason.com/pasonsystems/repos/puppet/puppet-r10k.git', () => {
      const input = 'https://gitlab.awspro.pason.com/pasonsystems/repos/puppet/puppet-r10k.git'
      expect(normalizeRemote(input)).toBe('gitlab.awspro.pason.com/pasonsystems/repos/puppet/puppet-r10k')
    })
    test('git@github.com:DataDog/datadog-junit4-tests.git', () => {
      const input = 'git@github.com:DataDog/datadog-junit4-tests.git'
      expect(normalizeRemote(input)).toBe('github.com/DataDog/datadog-junit4-tests')
    })
    test('https://github-ci-token:MYTOKEN@github.com/DataDog/datadog-junit4-tests.git', () => {
      const input = 'https://github-ci-token:MYTOKEN@github.com/DataDog/datadog-junit4-tests.git'
      expect(normalizeRemote(input)).toBe('github.com/DataDog/datadog-junit4-tests')
    })
    test('ssh://stash.cvent.net:7999/incb/sre-observ-test.git', () => {
      const input = 'ssh://stash.cvent.net:7999/incb/sre-observ-test.git'
      expect(normalizeRemote(input)).toBe('stash.cvent.net/incb/sre-observ-test')
    })
    test('git://host.xz:1234/~alex/path/to/repo.git', () => {
      const input = 'git://host.xz:1234/~alex/path/to/repo.git'
      expect(normalizeRemote(input)).toBe('host.xz/~alex/path/to/repo')
    })
    test('https://git.mcmakler.com/md.aftab/mcm-deploy.git', () => {
      const input = 'https://git.mcmakler.com/md.aftab/mcm-deploy.git'
      expect(normalizeRemote(input)).toBe('git.mcmakler.com/md.aftab/mcm-deploy')
    })
    test('org-49461806@github.com:squareup/riker.git', () => {
      const input = 'org-49461806@github.com:squareup/riker.git'
      expect(normalizeRemote(input)).toBe('github.com/squareup/riker')
    })
    test('org_49461806@github.com:squareup/hw-spe_automation.git', () => {
      const input = 'org_49461806@github.com:squareup/hw-spe_automation.git'
      expect(normalizeRemote(input)).toBe('github.com/squareup/hw-spe_automation')
    })
    test('bitbucket.org:harver/saas-talentpitch.git', () => {
      const input = 'bitbucket.org:harver/saas-talentpitch.git'
      expect(normalizeRemote(input)).toBe('bitbucket.org/harver/saas-talentpitch')
    })
    test('ssh.dev.azure.com:v3/bushelpowered/bushel-integrations-translator-mono/bushel-integrations-translator-mono', () => {
      const input =
        'ssh.dev.azure.com:v3/bushelpowered/bushel-integrations-translator-mono/bushel-integrations-translator-mono'
      expect(normalizeRemote(input)).toBe(
        'ssh.dev.azure.com/v3/bushelpowered/bushel-integrations-translator-mono/bushel-integrations-translator-mono'
      )
    })
  })

  describe('getCommitInfo', () => {
    test('should return commit info from simple git', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        remotes: [{name: 'first', refs: {push: 'https://git-host/repo'}}],
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock)

      expect(commitInfo).toBeDefined()
      expect(commitInfo!.hash).toBe('abcd')
      expect(commitInfo!.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo!.remote).toBe('https://git-host/repo')
    })
    test('should return commit info with overridden repo name', async () => {
      const mock = createMockSimpleGit({
        hash: 'abcd',
        trackedFiles: ['myfile.js'],
      }) as any
      const commitInfo = await getCommitInfo(mock, 'https://overridden/repo')

      expect(commitInfo).toBeDefined()
      expect(commitInfo!.hash).toBe('abcd')
      expect(commitInfo!.trackedFiles).toStrictEqual(['myfile.js'])
      expect(commitInfo!.remote).toBe('https://overridden/repo')
    })
  })

  describe('newSimpleGit', () => {
    test('should throw an error if git is not installed', async () => {
      jest.spyOn(simpleGit, 'gitP').mockImplementation(() => {
        throw Error('gitp error')
      })
      await expect(newSimpleGit()).rejects.toThrow('gitp error')
    })

    test('should throw an error if revparse throws an error', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'gitP').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockImplementation(async () => {
        throw Error('revparse error')
      })

      await expect(newSimpleGit()).rejects.toThrow('revparse error')
    })

    test('should not throw any errors', async () => {
      const mock = createMockSimpleGit({}) as any
      jest.spyOn(simpleGit, 'gitP').mockReturnValue(mock)
      jest.spyOn(mock, 'revparse').mockResolvedValue('1234')

      await expect(newSimpleGit()).resolves.not.toThrow()
    })
  })
})
