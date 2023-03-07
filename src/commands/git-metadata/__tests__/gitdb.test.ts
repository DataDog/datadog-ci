import child_process from 'child_process'
import fs from 'fs'
import os from 'os'

import {default as axios} from 'axios'

import {getRequestBuilder} from '../../../helpers/utils'

import {uploadToGitDB} from '../gitdb'
import {Logger, LogLevel} from '../utils'

describe('gitdb', () => {
  const tmpdir = os.tmpdir()

  const temporaryPackFile = `${tmpdir}/1000-87ce64f636853fbebc05edfcefe9cccc28a7968b.pack`
  const secondTemporaryPackFile = `${tmpdir}/1000-cc424c261da5e261b76d982d5d361a023556e2aa.pack`

  beforeAll(() => {
    process.env.DD_API_KEY = 'api-key'
    jest.spyOn(global.Math, 'random').mockReturnValue(0.1)
    fs.writeFileSync(temporaryPackFile, '')
    fs.writeFileSync(secondTemporaryPackFile, '')
  })

  afterAll(() => {
    delete process.env.DD_API_KEY
    jest.spyOn(global.Math, 'random').mockRestore()
    fs.unlinkSync(temporaryPackFile)
    fs.unlinkSync(secondTemporaryPackFile)
  })

  const logger = new Logger((_) => {}, LogLevel.INFO)
  const request = getRequestBuilder({
    apiKey: 'api-key',
    baseUrl: 'https://api.datadoghq.com',
  })
  const testError = new Error('call failed')

  type MockParam<I, O> = {
    input: I | undefined
    output: O | Error
  }
  interface MockParams {
    addConfig: MockParam<[string, string], string>[]
    fetch: MockParam<string[], any>[]
    getRemotes: MockParam<void, any>[]
    log: MockParam<string[], any>[]
    raw: MockParam<string[], string>[]
    revparse: MockParam<string, any>[]
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
      addConfig: jest.Mock
      fetch: jest.Mock
      getRemotes: jest.Mock
      log: jest.Mock
      raw: jest.Mock
      revparse: jest.Mock
    }
    public execSync: jest.Mock
    public axios: jest.Mock

    private addConfigMetExpectations: () => void
    private fetchMetExpectations: () => void
    private getRemotesMetExpectations: () => void
    private logMetExpectations: () => void
    private rawMetExpectations: () => void
    private revparseMetExpectations: () => void
    private execSyncMetExpectations: () => void
    private axiosMetExpectations: () => void

    private axiosCalls: {
      url: string
      data: string | undefined
    }[]

    constructor(mockParams: MockParams) {
      this.simpleGit = {
        addConfig: jest.fn(),
        fetch: jest.fn(),
        getRemotes: jest.fn(),
        log: jest.fn(),
        raw: jest.fn(),
        revparse: jest.fn(),
      }
      // call spyOn on these two mocks to make sure the underlying implementation is never called
      // as the default behavior of spyOn is to actually call the initial implem if not overridden
      this.execSync = jest.spyOn(child_process, 'execSync').mockImplementation(() => '') as jest.Mock
      this.axios = jest.spyOn(axios, 'create').mockImplementation(() => ((_: any) => {}) as any) as jest.Mock

      const initMockWithParams = <I, O>(mock: jest.Mock, params: MockParam<I, O>[], promise: boolean) => {
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
          expect(mock.mock.calls).toHaveLength(params.length)
          params.forEach((param, i) => {
            if (param.input !== undefined) {
              expect(mock.mock.calls[i][0]).toStrictEqual(param.input)
            }
          })
        }
      }

      // use dedicated function to initialize addConfig mock as I don't know how to use initMockWithParams
      // with a multi-args mock function
      const initAddConfigWithParams = (mock: jest.Mock, params: MockParam<[string, string], string>[]) => {
        params.forEach((param) => {
          if (param.output instanceof Error) {
            mock = mock.mockImplementationOnce((..._: any) => {
              throw param.output
            })
          } else {
            mock = mock.mockResolvedValueOnce(param.output)
          }
        })

        return () => {
          expect(mock.mock.calls).toHaveLength(params.length)
          params.forEach((param, i) => {
            if (param.input !== undefined) {
              expect(mock.mock.calls[i][0]).toStrictEqual(param.input[0])
              expect(mock.mock.calls[i][1]).toStrictEqual(param.input[1])
            }
          })
        }
      }

      this.addConfigMetExpectations = initAddConfigWithParams(this.simpleGit.addConfig, mockParams.addConfig)
      this.fetchMetExpectations = initMockWithParams(this.simpleGit.fetch, mockParams.fetch, true)
      this.getRemotesMetExpectations = initMockWithParams(this.simpleGit.getRemotes, mockParams.getRemotes, true)
      this.logMetExpectations = initMockWithParams(this.simpleGit.log, mockParams.log, true)
      this.rawMetExpectations = initMockWithParams(this.simpleGit.raw, mockParams.raw, true)
      this.revparseMetExpectations = initMockWithParams(this.simpleGit.revparse, mockParams.revparse, true)
      this.execSyncMetExpectations = initMockWithParams(this.execSync, mockParams.execSync, false)

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
      this.addConfigMetExpectations()
      this.fetchMetExpectations()
      this.getRemotesMetExpectations()
      this.logMetExpectations()
      this.rawMetExpectations()
      this.revparseMetExpectations()
      this.execSyncMetExpectations()
      this.axiosMetExpectations()
    }
  }

  test('should not work when remote is not present', async () => {
    const mocks = new MockAll({
      addConfig: [],
      fetch: [],
      getRemotes: [{input: undefined, output: testError}],
      log: [],
      raw: [],
      revparse: [],
      execSync: [],
      axios: [],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should unshallow repository', async () => {
    const mocks = new MockAll({
      addConfig: [{input: ['remote.origin.partialclonefilter', 'blob:none'], output: ''}],
      fetch: [{input: ['--shallow-since="1 month ago"', '--update-shallow', '--refetch'], output: ''}],
      getRemotes: [
        {
          input: undefined,
          output: [{name: 'origin', refs: {push: 'https://github.com/DataDog/datadog-ci'}}],
        },
      ],
      // throw an exception after the update shallow to shortcut the rest of the test as we only
      // care about updating the shallow clone, not about the rest of the process for this test
      log: [{input: undefined, output: testError}],
      raw: [],
      revparse: [{input: '--is-shallow-repository', output: 'true'}],
      execSync: [],
      axios: [],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    await expect(upload).rejects.toThrow(testError)
    mocks.expectCalls()
  })

  test('should send packfiles', async () => {
    const mocks = new MockAll({
      addConfig: [],
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
          input: ['rev-list', '--objects', '--no-object-names', '--filter=blob:none', '--since="1 month ago"', 'HEAD'],
          output: '87ce64f636853fbebc05edfcefe9cccc28a7968b\ncc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}/1000`,
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

  test('should omit known commits', async () => {
    const mocks = new MockAll({
      addConfig: [],
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
            'HEAD',
            '^87ce64f636853fbebc05edfcefe9cccc28a7968b',
          ],
          output: 'cc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}/1000`,
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
      addConfig: [],
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
            'HEAD',
            '^87ce64f636853fbebc05edfcefe9cccc28a7968b',
          ],
          output: 'cc424c261da5e261b76d982d5d361a023556e2aa\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
      execSync: [
        {
          input: `git pack-objects --compression=9 --max-pack-size=3m ${tmpdir}/1000`,
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
      addConfig: [],
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
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
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
      addConfig: [],
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
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
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
      addConfig: [],
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
            'HEAD',
            '^87ce64f636853fbebc05edfcefe9cccc28a7968b',
            '^cc424c261da5e261b76d982d5d361a023556e2aa',
          ],
          output: '\n',
        },
      ],
      revparse: [{input: '--is-shallow-repository', output: 'false'}],
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
