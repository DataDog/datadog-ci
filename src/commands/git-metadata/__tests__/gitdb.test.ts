import child_process from 'child_process'
import fs from 'fs'
import os from 'os'

import {default as axios} from 'axios'
import * as simpleGit from 'simple-git'

import {getRequestBuilder} from '../../../helpers/utils'

import {newSimpleGit} from '../git'
import {uploadToGitDB} from '../gitdb'
import {Logger, LogLevel} from '../utils'

let gitInstance: simpleGit.SimpleGit | undefined

const getGitInstance = async () => {
  if (gitInstance === undefined) {
    gitInstance = await newSimpleGit()
  }

  return gitInstance
}

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
    getRemotes: MockParam<void, Object>[]
    log: MockParam<string[], Object>[]
    raw: MockParam<string[], string>[]
    execSync: MockParam<string, Buffer>[]
    axios: MockParam<
      {
        url: string
        data: object | undefined
      },
      object
    >[]
  }

  class MockAll {
    public simpleGit: {
      getRemotes: jest.Mock
      log: jest.Mock
      raw: jest.Mock
    }
    public execSync: jest.Mock
    public axios: jest.Mock
    public expectCalls() {
      this.getRemotesMetExpectations()
      this.logMetExpectations()
      this.rawMetExpectations()
      this.execSyncMetExpectations()
      this.axiosMetExpectations()
    }

    private getRemotesMetExpectations: () => void
    private logMetExpectations: () => void
    private rawMetExpectations: () => void
    private execSyncMetExpectations: () => void
    private axiosMetExpectations: () => void

    private axiosCalls: {
      url: string
      data: string | undefined
    }[]

    constructor(params: MockParams) {
      this.simpleGit = {
        getRemotes: jest.fn(),
        log: jest.fn(),
        raw: jest.fn(),
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

      this.getRemotesMetExpectations = initMockWithParams(this.simpleGit.getRemotes, params.getRemotes, true)
      this.logMetExpectations = initMockWithParams(this.simpleGit.log, params.log, true)
      this.rawMetExpectations = initMockWithParams(this.simpleGit.raw, params.raw, true)
      this.execSyncMetExpectations = initMockWithParams(this.execSync, params.execSync, false)

      this.axiosCalls = []

      // custom way of handling axios
      params.axios.forEach((param) => {
        this.axios = this.axios.mockImplementationOnce(() => (request: any) => {
          this.axiosCalls.push({url: request.url, data: request.data})
          if (param.output instanceof Error) {
            throw param.output
          }

          return param.output
        })
      })
      this.axiosMetExpectations = () => {
        expect(this.axios.mock.calls).toHaveLength(params.axios.length)
        params.axios.forEach((param, i) => {
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
  }

  test('should not work when remote is not present', async () => {
    const mocks = new MockAll({
      getRemotes: [{input: undefined, output: testError}],
      log: [],
      raw: [],
      execSync: [],
      axios: [],
    })
    const upload = uploadToGitDB(logger, request, mocks.simpleGit as any, false)
    expect(upload).rejects.toThrow(testError)
    try {
      await upload
    } catch (e) {}
    mocks.expectCalls()
  })

  test('should send packfiles', async () => {
    const mocks = new MockAll({
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
    expect(upload).resolves
    await upload
    mocks.expectCalls()
  })

  test('should omit known commits', async () => {
    const mocks = new MockAll({
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
    expect(upload).resolves
    await upload
    mocks.expectCalls()
  })

  test('retries http requests', async () => {
    const mocks = new MockAll({
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
    expect(upload).resolves
    await upload
    mocks.expectCalls()
  })

  test('fails after 3 http requests', async () => {
    const mocks = new MockAll({
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
    expect(upload).rejects
    try {
      await upload
    } catch (e) {}
    mocks.expectCalls()
  })

  test('fail immediately if returned format is incorrect', async () => {
    const mocks = new MockAll({
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
    expect(upload).rejects
    try {
      await upload
    } catch (e) {}
    mocks.expectCalls()
  })

  test('all commits are known, no packfile upload', async () => {
    const mocks = new MockAll({
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
    expect(upload).resolves
    await upload
    mocks.expectCalls()
  })
})
