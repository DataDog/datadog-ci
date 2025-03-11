import child_process from 'child_process'
import fs from 'fs'
import fspromises from 'fs/promises'
import os from 'os'
import path from 'path'

import {default as axios} from 'axios'
import * as simpleGit from 'simple-git'

import {Logger, LogLevel} from '../../../helpers/logger'
import {getRequestBuilder} from '../../../helpers/utils'

import {uploadToGitDB} from '../gitdb'

describe('gitdb', () => {
  const tmpdir = path.join(os.tmpdir(), 'random')

  const temporaryPackFile = `${tmpdir}/1000-87ce64f636853fbebc05edfcefe9cccc28a7968b.pack`
  const secondTemporaryPackFile = `${tmpdir}/1000-cc424c261da5e261b76d982d5d361a023556e2aa.pack`

  beforeAll(() => {
    process.env.DD_API_KEY = 'api-key'
    jest.spyOn(global.Math, 'random').mockReturnValue(0.1)
  })

  beforeEach(() => {
    fs.mkdirSync(tmpdir, {
      recursive: true,
    })
    jest.spyOn(fspromises, 'mkdtemp').mockResolvedValue(tmpdir)
    fs.writeFileSync(temporaryPackFile, '')
    fs.writeFileSync(secondTemporaryPackFile, '')
  })

  afterEach(() => {
    jest.spyOn(fspromises, 'mkdtemp').mockRestore()
  })

  afterAll(() => {
    delete process.env.DD_API_KEY
    jest.spyOn(global.Math, 'random').mockRestore()
  })

  const logger = new Logger((_) => {}, LogLevel.INFO)
  const request = getRequestBuilder({
    apiKey: 'api-key',
    baseUrl: 'https://api.datadoghq.com',
  })
  const testError = new Error('call failed')

  // This is a bit hacky but the documentation of simpleGit asks you to depend on
  // a behavior of VersionResult which is not defined in its typings: it has an
  // override on toString. Here I am replicating this toString behavior so that
  // the tests pass. See https://github.com/steveukx/git-js/blob/d184c13273abca4b6572c260f9625c19f944d4f7/simple-git/src/lib/tasks/version.ts#L15-L39
  const newGitVersion: simpleGit.VersionResult = Object.defineProperty(
    {
      major: 2,
      minor: 41,
      patch: 0,
      agent: '',
      installed: true,
    },
    'toString',
    {
      value() {
        return `${this.major}.${this.minor}.${this.patch}`
      },
      configurable: false,
      enumerable: false,
    }
  )
  const oldGitVersion: simpleGit.VersionResult = Object.defineProperty(
    {
      major: 2,
      minor: 20,
      patch: 3,
      agent: '',
      installed: true,
    },
    'toString',
    {
      value() {
        return `${this.major}.${this.minor}.${this.patch}`
      },
      configurable: false,
      enumerable: false,
    }
  )

  const defaultRemoteNameNotConfigured = {
    key: 'clone.defaultRemoteName',
    paths: [],
    scopes: new Map<string, string[]>(),
    // eslint-disable-next-line no-null/no-null
    value: null,
    values: [],
  }

  type MockParam<I, O> = {
    input: I | undefined
    output: O | Error
  }
  interface MockParams {
    getConfig: MockParam<string, simpleGit.ConfigGetResult>[]
    fetch: MockParam<string[], any>[]
    getRemotes: MockParam<void, any>[]
    log: MockParam<string[], any>[]
    raw: MockParam<string[], string>[]
    revparse: MockParam<string, any>[]
    version: MockParam<void, simpleGit.VersionResult>[]
    execSync: MockParam<string, Buffer>[]
    axios: MockParam<
      {
        url: string
        data: any | undefined
      },
      any
    >[]
  }

  class MockAll {
    public simpleGit: {
      getConfig: jest.Mock
      fetch: jest.Mock
      getRemotes: jest.Mock
      log: jest.Mock
      raw: jest.Mock
      revparse: jest.Mock
      version: jest.Mock
    }
    public execSync: jest.Mock
    public axios: jest.Mock

    private getConfigMetExpectations: () => void
    private fetchMetExpectations: () => void
    private getRemotesMetExpectations: () => void
    private logMetExpectations: () => void
    private rawMetExpectations: () => void
    private revparseMetExpectations: () => void
    private versionMetExpectations: () => void
    private execSyncMetExpectations: () => void
    private axiosMetExpectations: () => void

    private axiosCalls: {
      url: string
      data: string | undefined
    }[]

    constructor(mockParams: MockParams) {
      this.simpleGit = {
        getConfig: jest.fn(),
        fetch: jest.fn(),
        getRemotes: jest.fn(),
        log: jest.fn(),
        raw: jest.fn(),
        revparse: jest.fn(),
        version: jest.fn(),
      }
      // call spyOn on these two mocks to make sure the underlying implementation is never called
      // as the default behavior of spyOn is to actually call the initial implem if not overridden
      this.execSync = jest.spyOn(child_process, 'execSync').mockImplementation(() => '') as jest.Mock
      this.axios = jest.spyOn(axios, 'create').mockImplementation(() => ((_: any) => {}) as any) as jest.Mock

      const initMockWithParams = <I, O>(mock: jest.Mock, params: MockParam<I, O>[], promise: boolean, name = '') => {
        params.forEach((param) => {
          if (param.output instanceof Error) {
            mock = mock.mockImplementationOnce((..._: any) => {
              throw param.output
            })
          } else {
            if (promise) {
              mock = mock.mockResolvedValueOnce(param.output)
            } else {
              mock = mock.mockReturnValueOnce(param.output)
            }
          }
        })

        return () => {
          try {
            expect(mock.mock.calls).toHaveLength(params.length)
            params.forEach((param, i) => {
              if (param.input !== undefined) {
                expect(mock.mock.calls[i][0]).toStrictEqual(param.input)
              }
            })
          } catch (e) {
            // To make it easier to debug the tests
            // eslint-disable-next-line
            console.log('Error in', name, 'mock')
            throw e
          }
        }
      }

      this.getConfigMetExpectations = initMockWithParams(
        this.simpleGit.getConfig,
        mockParams.getConfig,
        true,
        'getConfig'
      )
      this.fetchMetExpectations = initMockWithParams(this.simpleGit.fetch, mockParams.fetch, true, 'fetch')
      this.getRemotesMetExpectations = initMockWithParams(
        this.simpleGit.getRemotes,
        mockParams.getRemotes,
        true,
        'getRemotes'
      )
      this.logMetExpectations = initMockWithParams(this.simpleGit.log, mockParams.log, true, 'log')
      this.rawMetExpectations = initMockWithParams(this.simpleGit.raw, mockParams.raw, true, 'raw')
      this.revparseMetExpectations = initMockWithParams(this.simpleGit.revparse, mockParams.revparse, true, 'revparse')
      this.versionMetExpectations = initMockWithParams(this.simpleGit.version, mockParams.version, true, 'version')
      this.execSyncMetExpectations = initMockWithParams(this.execSync, mockParams.execSync, false, 'execSync')

      this.axiosCalls = []

      // custom way of handling axios
      mockParams.axios.forEach((param) => {
        this.axios = this.axios.mockImplementationOnce(() => (req: any) => {
          this.axiosCalls.push({url: req.url, data: req.data})
          if (param.output instanceof Error) {
            throw param.output
          }

          return param.output
        })
      })
      this.axiosMetExpectations = () => {
        expect(this.axios.mock.calls).toHaveLength(mockParams.axios.length)
        mockParams.axios.forEach((param, i) => {
          if (param.input !== undefined) {
            expect(this.axiosCalls[i].url).toBe(param.input.url)
            if (param.input.data !== undefined) {
              const data = this.axiosCalls[i].data as string
              expect(JSON.parse(data)).toStrictEqual(param.input.data)
            }
          }
        })
      }
    }

    public expectCalls() {
      this.getConfigMetExpectations()
      this.fetchMetExpectations()
      this.getRemotesMetExpectations()
      this.logMetExpectations()
      this.rawMetExpectations()
      this.revparseMetExpectations()
      this.versionMetExpectations()
      this.execSyncMetExpectations()
      this.axiosMetExpectations()
    }
  }

  test('should not work when remote is not present', async () => {
    const mocks = new MockAll({
      getConfig: [],
      fetch: [],
      getRemotes: [{input: undefined, output: testError}],
      log: [],
      raw: [],
      revparse: [],
      version: [],
      execSync: [],
      axios: [],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should unshallow repository if git version is recent and backend does not have all commits already', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
            'COMMIT',
          ],
          output: '',
        },
      ],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
        // throw an exception after the update shallow to shortcut the rest of the test as we only
        // care about updating the shallow clone, not about the rest of the process for this test
        {input: undefined, output: testError},
      ],
      raw: [],
      revparse: [
        {input: '--is-shallow-repository', output: 'true'},
        {input: 'HEAD', output: 'COMMIT'},
      ],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should unshallow repository with custom origin value', async () => {
    // MockParam<string, simpleGit.ConfigGetResult>[]
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'myorigin',
            values: [],
          },
        },
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'myorigin',
            values: [],
          },
        },
      ],
      fetch: [
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'myorigin',
            'COMMIT',
          ],
          output: '',
        },
      ],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
        // throw an exception after the update shallow to shortcut the rest of the test as we only
        // care about updating the shallow clone, not about the rest of the process for this test
        {input: undefined, output: testError},
      ],
      raw: [],
      revparse: [
        {input: '--is-shallow-repository', output: 'true'},
        {input: 'HEAD', output: 'COMMIT'},
      ],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should not unshallow repository if git version is old', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      // throw an exception after the failed unshallow to shortcut the rest of the test
      raw: [{input: undefined, output: testError}],
      revparse: [],
      version: [{input: undefined, output: oldGitVersion}],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should not unshallow repository if backend has all commits already', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [],
      revparse: [],
      version: [],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {
            data: {
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })

  test('should unshallow repository if the local HEAD is a commit not pushed to the remote', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'origin',
            values: [],
          },
        },
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'origin',
            values: [],
          },
        },
      ],
      fetch: [
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
            'commit',
          ],
          output: new Error('commit not found'),
        },
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
            'origin/branch',
          ],
          output: '',
        },
      ],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
        // we short circuit the test after the unshallow
        {input: undefined, output: testError},
      ],
      raw: [],
      revparse: [
        {input: '--is-shallow-repository', output: 'true'},
        {input: 'HEAD', output: 'commit'},
        {input: '--abbrev-ref --symbolic-full-name @{upstream}', output: 'origin/branch'},
      ],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test("should unshallow repository if the CI is working on a detached HEAD or branch tracking hasn't been set up", async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'origin',
            values: [],
          },
        },
        {
          input: 'clone.defaultRemoteName',
          output: {
            key: 'clone.defaultRemoteName',
            paths: [],
            scopes: new Map<string, string[]>(),
            value: 'origin',
            values: [],
          },
        },
      ],
      fetch: [
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
            'commit',
          ],
          output: new Error('commit not found'),
        },
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
            'origin/branch',
          ],
          output: new Error('working in detached mode'),
        },
        {
          input: [
            '--shallow-since="1 month ago"',
            '--update-shallow',
            '--filter=blob:none',
            '--recurse-submodules=no',
            'origin',
          ],
          output: '',
        },
      ],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
        // we short circuit the test after the unshallow
        {input: undefined, output: testError},
      ],
      raw: [],
      revparse: [
        {input: '--is-shallow-repository', output: 'true'},
        {input: 'HEAD', output: 'commit'},
        {input: '--abbrev-ref --symbolic-full-name @{upstream}', output: 'origin/branch'},
      ],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should send packfiles', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [
        {
          input: [
            'rev-list',
            '--objects',
            '--no-object-names',
            '--filter=blob:none',
            '--since="1 month ago"',
            '87ce64f636853fbebc05edfcefe9cccc28a7968b',
            'cc424c261da5e261b76d982d5d361a023556e2aa',
          ],
          output: '87ce64f636853fbebc05edfcefe9cccc28a7968b\ncc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}${path.sep}1000`,
          output: Buffer.from('87ce64f636853fbebc05edfcefe9cccc28a7968b\ncc424c261da5e261b76d982d5d361a023556e2aa\n'),
        },
      ],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })

  test('should override repository URL when specified', async () => {
    const mocks = new MockAll({
      getConfig: [],
      fetch: [],
      getRemotes: [],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [
        {
          input: [
            'rev-list',
            '--objects',
            '--no-object-names',
            '--filter=blob:none',
            '--since="1 month ago"',
            '87ce64f636853fbebc05edfcefe9cccc28a7968b',
            'cc424c261da5e261b76d982d5d361a023556e2aa',
          ],
          output: '87ce64f636853fbebc05edfcefe9cccc28a7968b\ncc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}${path.sep}1000`,
          output: Buffer.from('87ce64f636853fbebc05edfcefe9cccc28a7968b\ncc424c261da5e261b76d982d5d361a023556e2aa\n'),
        },
      ],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/mycustomrepo',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {data: {data: []}},
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
      ],
    })
    const upload = uploadToGitDB(
      logger,
      request,
      mocks.simpleGit as any,
      false,
      'https://github.com/DataDog/mycustomrepo'
    )
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })

  test('should omit known commits', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [
        {
          input: [
            'rev-list',
            '--objects',
            '--no-object-names',
            '--filter=blob:none',
            '--since="1 month ago"',
            '^87ce64f636853fbebc05edfcefe9cccc28a7968b',
            'cc424c261da5e261b76d982d5d361a023556e2aa',
          ],
          output: 'cc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}${path.sep}1000`,
          output: Buffer.from('cc424c261da5e261b76d982d5d361a023556e2aa\n'),
        },
      ],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {
            data: {
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
              ],
            },
          },
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })

  test('retries http requests', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [
        {
          input: [
            'rev-list',
            '--objects',
            '--no-object-names',
            '--filter=blob:none',
            '--since="1 month ago"',
            '^87ce64f636853fbebc05edfcefe9cccc28a7968b',
            'cc424c261da5e261b76d982d5d361a023556e2aa',
          ],
          output: 'cc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      version: [{input: undefined, output: newGitVersion}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}${path.sep}1000`,
          output: Buffer.from('cc424c261da5e261b76d982d5d361a023556e2aa\n'),
        },
      ],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: new Error('http error'),
        },
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {
            data: {
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
              ],
            },
          },
        },
        {
          input: {
            url: '/api/v2/git/repository/packfile',
            data: undefined,
          },
          output: {},
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })

  test('fails after 3 http requests', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [],
      revparse: [],
      version: [],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: new Error('http error'),
        },
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: new Error('http error'),
        },
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: new Error('http error'),
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow('http error')
    mocks.expectCalls()
  })

  test('fail immediately if returned format is incorrect', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [],
      revparse: [],
      version: [],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {
            data: {
              data: [
                {
                  type: 'commit',
                },
                {
                  type: 'commit',
                },
              ],
            },
          },
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow('Invalid commit type response')
    mocks.expectCalls()
  })

  test('all commits are known, no packfile upload', async () => {
    const mocks = new MockAll({
      getConfig: [
        {
          input: 'clone.defaultRemoteName',
          output: defaultRemoteNameNotConfigured,
        },
      ],
      fetch: [],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      log: [
        {
          input: ['-n 1000', '--since="1 month ago"'],
          output: {
            all: [
              {
                hash: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
              },
              {
                hash: 'cc424c261da5e261b76d982d5d361a023556e2aa',
              },
            ],
          },
        },
      ],
      raw: [],
      revparse: [],
      version: [],
      execSync: [],
      axios: [
        {
          input: {
            url: '/api/v2/git/repository/search_commits',
            data: {
              meta: {
                repository_url: 'https://github.com/DataDog/datadog-ci',
              },
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
          output: {
            data: {
              data: [
                {
                  id: '87ce64f636853fbebc05edfcefe9cccc28a7968b',
                  type: 'commit',
                },
                {
                  id: 'cc424c261da5e261b76d982d5d361a023556e2aa',
                  type: 'commit',
                },
              ],
            },
          },
        },
      ],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).resolves.toBe(undefined)
    mocks.expectCalls()
  })
})
