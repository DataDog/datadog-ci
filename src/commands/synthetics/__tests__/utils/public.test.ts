jest.mock('glob')
jest.mock('fs')
jest.mock('child_process')
jest.unmock('chalk')

jest.mock('path', () => {
  const actualPath: typeof path = jest.requireActual('path')

  return {
    ...actualPath,
    relative: (from: string, to: string) => {
      if (from === '/path/to/project' && to === '/path/to/another-project') {
        return '../another-project'
      }

      if (from === '/path/to/project' && to === '/other-path/to/project') {
        return '../../../other-path/to/project'
      }

      if (from === '/path/to/git/repository' && to === '/path/to/another-project') {
        return '../../another-project'
      }

      if (from === '/path/to/git/repository' && to === '/other-path/to/project') {
        return '../../../../other-path/to/project'
      }

      if (from.endsWith('subfolder') || to.endsWith('subfolder')) {
        return 'subfolder'
      }

      if (to === '..') {
        return '..'
      }

      return '.'
    },
  }
})

import child_process from 'child_process'
import * as fs from 'fs'
import process from 'process'

import type * as path from 'path'

import {default as axios} from 'axios'
import deepExtend from 'deep-extend'
import glob from 'glob'

process.env.DATADOG_SYNTHETICS_CI_TRIGGER_APP = 'env_default'

import {getAxiosError, MOCK_BASE_URL} from '../../../../helpers/__tests__/fixtures'
import * as ciHelpers from '../../../../helpers/ci'
import {Metadata} from '../../../../helpers/interfaces'
import * as ciUtils from '../../../../helpers/utils'

import {apiConstructor, APIHelper} from '../../api'
import {CiError, CiErrorCode, CriticalError, BatchTimeoutRunawayError} from '../../errors'
import {
  BaseResult,
  Batch,
  ExecutionRule,
  PollResult,
  Result,
  SelectiveRerunDecision,
  ServerResult,
  SyntheticsCIConfig,
  Test,
  Trigger,
  UserConfigOverride,
} from '../../interfaces'
import * as mobile from '../../mobile'
import {DEFAULT_COMMAND_CONFIG, DEFAULT_POLLING_TIMEOUT, MAX_TESTS_TO_TRIGGER} from '../../run-tests-command'
import * as utils from '../../utils/public'

import {
  ciConfig,
  getApiResult,
  getApiTest,
  getBatch,
  getBrowserServerResult,
  getFailedResultInBatch,
  getIncompleteServerResult,
  getInProgressResultInBatch,
  getPassedResultInBatch,
  getResults,
  getSkippedResultInBatch,
  getSummary,
  MockedReporter,
  mockLocation,
  mockReporter,
  RenderResultsTestCase,
} from '../fixtures'

describe('utils', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ciUtils.ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  describe('getSuites', () => {
    const GLOB = 'testGlob'
    const FILES = ['file1', 'file2']
    const FILES_CONTENT = {
      file1: '{"tests":"file1"}',
      file2: '{"tests":"file2"}',
    }

    ;(fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path])
    )
    ;(glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES))
    ;(child_process.exec as any).mockImplementation(
      (command: string, callback: (error: any, stdout: string, stderr: string) => void) => callback(undefined, '.', '')
    )

    test('should get suites', async () => {
      const suites = await utils.getSuites(GLOB, mockReporter)
      expect(JSON.stringify(suites)).toBe(
        `[{"name":"file1","content":${FILES_CONTENT.file1}},{"name":"file2","content":${FILES_CONTENT.file2}}]`
      )
    })
  })

  describe('getFilePathRelativeToRepo', () => {
    test('datadog-ci is not run in a git repository', async () => {
      const pathToProject = '/path/to/project'
      jest.spyOn(process, 'cwd').mockImplementation(() => pathToProject)

      // Directory without `.git` folder.
      ;(child_process.exec as any).mockImplementation(
        (command: string, callback: (error: any, stdout: string, stderr: string) => void) =>
          callback(Error('Not a git repository'), '', '')
      )

      // Use the process working directory instead of the git repository's top level.
      await expect(utils.getFilePathRelativeToRepo('config.json')).resolves.toEqual('config.json')
      await expect(utils.getFilePathRelativeToRepo('./config.json')).resolves.toEqual('config.json')
      await expect(utils.getFilePathRelativeToRepo(`${pathToProject}/config.json`)).resolves.toEqual('config.json')

      // Those cases will show a broken hyperlink in the GitLab test report because the file is outside of the project.
      await expect(utils.getFilePathRelativeToRepo('../config.json')).resolves.toEqual('../config.json')
      await expect(utils.getFilePathRelativeToRepo('/path/to/another-project/config.json')).resolves.toEqual(
        '../another-project/config.json'
      )
      await expect(utils.getFilePathRelativeToRepo('/other-path/to/project/config.json')).resolves.toEqual(
        '../../../other-path/to/project/config.json'
      )
    })

    test('datadog-ci is run in the root of a git repository', async () => {
      const pathToGitRepository = '/path/to/git/repository'
      jest.spyOn(process, 'cwd').mockImplementation(() => pathToGitRepository)

      // Process working directory is the git repository's root.
      ;(child_process.exec as any).mockImplementation(
        (command: string, callback: (error: any, stdout: string, stderr: string) => void) =>
          callback(undefined, pathToGitRepository, '')
      )

      await expect(utils.getFilePathRelativeToRepo('config.json')).resolves.toEqual('config.json')
      await expect(utils.getFilePathRelativeToRepo('./config.json')).resolves.toEqual('config.json')
      await expect(utils.getFilePathRelativeToRepo(`${pathToGitRepository}/config.json`)).resolves.toEqual(
        'config.json'
      )

      await expect(utils.getFilePathRelativeToRepo('subfolder/config.json')).resolves.toEqual('subfolder/config.json')
      await expect(utils.getFilePathRelativeToRepo('./subfolder/config.json')).resolves.toEqual('subfolder/config.json')
      await expect(utils.getFilePathRelativeToRepo(`${pathToGitRepository}/subfolder/config.json`)).resolves.toEqual(
        'subfolder/config.json'
      )

      // Those cases will show a broken hyperlink in the GitLab test report because the file is outside of the repository.
      await expect(utils.getFilePathRelativeToRepo('../config.json')).resolves.toEqual('../config.json')
      await expect(utils.getFilePathRelativeToRepo('/path/to/another-project/config.json')).resolves.toEqual(
        '../../another-project/config.json'
      )
      await expect(utils.getFilePathRelativeToRepo('/other-path/to/project/config.json')).resolves.toEqual(
        '../../../../other-path/to/project/config.json'
      )
    })

    test('datadog-ci is run in a subfolder of a git repository', async () => {
      const pathToGitRepositorySubfolder = '/path/to/git/repository/subfolder'
      jest.spyOn(process, 'cwd').mockImplementation(() => pathToGitRepositorySubfolder)

      // Process working directory is a subfolder of the git repository...
      ;(child_process.exec as any).mockImplementation(
        (command: string, callback: (error: any, stdout: string, stderr: string) => void) =>
          callback(undefined, '/path/to/git/repository', '')
      )

      // ...so the relative path must be prefixed with the subfolder.
      await expect(utils.getFilePathRelativeToRepo('config.json')).resolves.toEqual('subfolder/config.json')
      await expect(utils.getFilePathRelativeToRepo('./config.json')).resolves.toEqual('subfolder/config.json')
      await expect(utils.getFilePathRelativeToRepo(`${pathToGitRepositorySubfolder}/config.json`)).resolves.toEqual(
        'subfolder/config.json'
      )
    })
  })

  describe('runTest', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    const fakeId = '123-456-789'
    const fakeTrigger: Trigger = {
      batch_id: 'bid',
      locations: [],
    }

    test('should run test', async () => {
      jest.spyOn(api, 'triggerTests').mockImplementation(async () => fakeTrigger)
      const output = await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(output).toEqual(fakeTrigger)
    })

    test('runTests sends batch metadata', async () => {
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => undefined)

      const payloadMetadataSpy = jest.fn()
      jest.spyOn(axios, 'create').mockImplementation((() => (request: any) => {
        payloadMetadataSpy(request.data.metadata)
        if (request.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(payloadMetadataSpy).toHaveBeenCalledWith(undefined)

      const metadata: Metadata = {
        ci: {job: {name: 'job'}, pipeline: {}, provider: {name: 'jest'}, stage: {}},
        git: {commit: {author: {}, committer: {}, message: 'test'}},
      }
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => metadata)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(payloadMetadataSpy).toHaveBeenCalledWith(metadata)
    })

    test('runTests api call includes trigger app header', async () => {
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => undefined)

      const headersMetadataSpy = jest.fn()
      jest.spyOn(axios, 'create').mockImplementation((() => (request: any) => {
        headersMetadataSpy(request.headers)
        if (request.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(headersMetadataSpy).toHaveBeenCalledWith(expect.objectContaining({'X-Trigger-App': 'env_default'}))

      utils.setCiTriggerApp('unit_test')
      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(headersMetadataSpy).toHaveBeenCalledWith(expect.objectContaining({'X-Trigger-App': 'unit_test'}))
    })

    test('runTests api call does not send deprecated properties', async () => {
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => undefined)

      const testsPayloadSpy = jest.fn()
      jest.spyOn(axios, 'create').mockImplementation((() => (request: any) => {
        testsPayloadSpy(request.data.tests)
        if (request.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING, pollingTimeout: 1}])
      expect(testsPayloadSpy).toHaveBeenCalledWith([
        {
          public_id: fakeId,
          executionRule: ExecutionRule.NON_BLOCKING,
          // no pollingTimeout
        },
      ])
    })

    test('should run test with publicId from url', async () => {
      jest.spyOn(api, 'triggerTests').mockImplementation(async () => fakeTrigger)
      const output = await utils.runTests(api, [
        {
          executionRule: ExecutionRule.NON_BLOCKING,
          public_id: `http://localhost/synthetics/tests/details/${fakeId}`,
        },
      ])
      expect(output).toEqual(fakeTrigger)
    })

    test('triggerTests throws', async () => {
      jest.spyOn(api, 'triggerTests').mockImplementation(() => {
        throw getAxiosError(502, {message: 'Server Error'})
      })

      await expect(
        utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      ).rejects.toThrow(/Failed to trigger tests:/)
    })
  })

  describe('getTestsToTrigger', () => {
    const fakeTests: {[id: string]: any} = {
      '123-456-789': {
        config: {request: {url: 'http://example.org/'}},
        name: 'Fake Test',
        public_id: '123-456-789',
        suite: 'Suite 1',
      },
      'mob-ile-tes': {
        config: {},
        name: 'Fake Mobile Test',
        options: {
          mobileApplication: {
            applicationId: 'appId',
            referenceId: 'versionId',
            referenceType: 'version',
          },
        },
        public_id: 'mob-ile-tes',
        suite: 'Suite 3',
        type: 'mobile',
      },
      'ski-ppe-d01': {
        config: {request: {url: 'http://example.org/'}},
        name: 'Skipped Fake Test',
        options: {ci: {executionRule: 'skipped'}},
        public_id: 'ski-ppe-d01',
        suite: 'Suite 3',
      },
    }

    beforeEach(() => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        const publicId = e.url.slice(18)
        if (fakeTests[publicId]) {
          return {data: fakeTests[publicId]}
        }

        throw getAxiosError(404, {errors: ['Not found']})
      }) as any)
    })

    test('only existing tests are returned', async () => {
      const triggerConfigs = [
        {suite: 'Suite 1', config: {}, id: '123-456-789'},
        {suite: 'Suite 2', config: {}, id: '987-654-321'},
        {suite: 'Suite 3', config: {}, id: 'ski-ppe-d01'},
      ]
      const {tests, overriddenTestsToTrigger, initialSummary} = await utils.getTestsToTrigger(
        api,
        triggerConfigs,
        mockReporter
      )

      expect(tests).toStrictEqual([fakeTests['123-456-789']])
      expect(overriddenTestsToTrigger).toStrictEqual([{public_id: '123-456-789'}, {public_id: 'ski-ppe-d01'}])

      const expectedSummary: utils.InitialSummary = {
        criticalErrors: 0,
        expected: 0,
        failed: 0,
        failedNonBlocking: 0,
        passed: 0,
        previouslyPassed: 0,
        skipped: 1,
        testsNotFound: new Set(['987-654-321']),
        timedOut: 0,
      }
      expect(initialSummary).toEqual(expectedSummary)
    })

    test('no tests triggered throws an error', async () => {
      await expect(utils.getTestsToTrigger(api, [], mockReporter)).rejects.toEqual(new CiError('NO_TESTS_TO_RUN'))
    })

    describe('too many tests to trigger', () => {
      const fakeApi: APIHelper = {
        ...api,
        getTest: (id: string) => {
          if (id === 'missing') {
            throw new Error('Request error')
          }

          const test = {...getApiTest(id)}
          if (id === 'skipped') {
            test.options.ci = {executionRule: ExecutionRule.SKIPPED}
          }

          return Promise.resolve(test)
        },
      }

      test('trim and warn if from search', async () => {
        const tooManyTests = Array(MAX_TESTS_TO_TRIGGER + 10).fill({id: 'stu-vwx-yza'})
        const tests = await utils.getTestsToTrigger(fakeApi, tooManyTests, mockReporter, true)
        expect(tests.tests.length).toBe(MAX_TESTS_TO_TRIGGER)
        expect(mockReporter.initErrors).toMatchSnapshot()
      })

      test('fails outside of search', async () => {
        const tooManyTests = Array(MAX_TESTS_TO_TRIGGER + 10).fill({id: 'stu-vwx-yza'})
        await expect(utils.getTestsToTrigger(fakeApi, tooManyTests, mockReporter, false)).rejects.toEqual(
          new Error(`Cannot trigger more than ${MAX_TESTS_TO_TRIGGER} tests (received ${tooManyTests.length})`)
        )
      })

      test('does not account for skipped/not found tests outside of search', async () => {
        const tooManyTests = [
          ...Array(MAX_TESTS_TO_TRIGGER).fill({id: 'stu-vwx-yza'}),
          {id: 'skipped'},
          {id: 'missing'},
        ]
        const tests = await utils.getTestsToTrigger(fakeApi, tooManyTests, mockReporter, true)
        expect(tests.tests.length).toBe(MAX_TESTS_TO_TRIGGER)
      })
    })

    test('call uploadApplicationAndOverrideConfig on mobile test', async () => {
      const spy = jest.spyOn(mobile, 'uploadMobileApplicationsAndUpdateOverrideConfigs').mockImplementation()
      const triggerConfigs = [
        {suite: 'Suite 1', config: {}, id: '123-456-789'},
        {suite: 'Suite 3', config: {}, id: 'mob-ile-tes'},
      ]

      await utils.getTestsToTrigger(api, triggerConfigs, mockReporter)
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  describe('getTestAndOverrideConfig', () => {
    test('Forbidden error when getting a test', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        throw getAxiosError(403, {message: 'Forbidden'})
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}

      await expect(() =>
        utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())
      ).rejects.toThrow('Failed to get test: could not query https://app.datadoghq.com/example\nForbidden\n')
    })

    test('Passes when public ID is valid', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {data: {subtype: 'http', public_id: '123-456-789'}}
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      expect(await utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toEqual(
        expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
      )
    })

    test('Fails when public ID is NOT valid', async () => {
      const expectedError = new CiError('INVALID_CONFIG', `No valid public ID found in: \`a123-456-789\``)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: 'a123-456-789'}
      await expect(utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).rejects.toThrow(
        expectedError
      )
    })

    test('Passes when the tunnel is enabled for HTTP test', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {data: {subtype: 'http', public_id: '123-456-789'}}
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      expect(await utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
        expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
      )
    })

    test('Passes when the tunnel is enabled for Browser test', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {data: {type: 'browser', public_id: '123-456-789'}}
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      expect(await utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
        expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', type: 'browser'})})
      )
    })

    test('Passes when the tunnel is enabled for Multi step test with HTTP steps only', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {
          data: {
            type: 'api',
            subtype: 'multi',
            config: {steps: [{subtype: 'http'}, {subtype: 'http'}]},
            public_id: '123-456-789',
          },
        }
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      expect(await utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
        expect.objectContaining({
          test: expect.objectContaining({
            public_id: '123-456-789',
            type: 'api',
            subtype: 'multi',
            config: {steps: [{subtype: 'http'}, {subtype: 'http'}]},
          }),
        })
      )
    })

    test('Fails when the tunnel is enabled for an unsupported test type', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {data: {subtype: 'grpc', type: 'api', public_id: '123-456-789'}}
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      await expect(() =>
        utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)
      ).rejects.toThrow(
        'The tunnel is only supported with HTTP API tests and Browser tests (public ID: 123-456-789, type: api, sub-type: grpc).'
      )
    })

    test('Fails when the tunnel is enabled for unsupported steps in a Multi step test', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        return {
          data: {
            type: 'api',
            subtype: 'multi',
            config: {steps: [{subtype: 'dns'}, {subtype: 'ssl'}, {subtype: 'http'}]},
            public_id: '123-456-789',
          },
        }
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
      await expect(() =>
        utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)
      ).rejects.toThrow(
        'The tunnel is only supported with HTTP API tests and Browser tests (public ID: 123-456-789, type: api, sub-type: multi, step sub-types: [dns, ssl]).'
      )
    })
  })

  describe('normalizePublicId', () => {
    test('should normalize public ID', () => {
      expect(utils.normalizePublicId('http://localhost/synthetics/tests/details/123-456-789')).toBe('123-456-789')
      expect(utils.normalizePublicId('123-456-789')).toBe('123-456-789')
    })
    test('should be undefined if id is invalid', () => {
      expect(utils.normalizePublicId('http://localhost/synthetics/tests/details/123-456-7890')).toBe(undefined)
      expect(utils.normalizePublicId('0123-456-789')).toBe(undefined)
    })
  })

  describe('getOverriddenConfig', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi'
      expect(utils.getOverriddenConfig({public_id: publicId} as Test, publicId, mockReporter)).toEqual({
        public_id: publicId,
      })
    })

    test('strictest executionRule is forwarded when it has to be', () => {
      const expectHandledConfigToBe = (
        expectedExecutionRule: ExecutionRule | undefined,
        configExecutionRule?: ExecutionRule,
        testExecutionRule?: ExecutionRule
      ) => {
        const publicId = 'abc-def-ghi'
        const fakeTest = {
          config: {request: {url: 'http://example.org/path'}},
          options: {},
          public_id: publicId,
        } as Test

        if (testExecutionRule) {
          fakeTest.options.ci = {executionRule: testExecutionRule}
        }

        const configOverride = configExecutionRule ? {executionRule: configExecutionRule} : undefined

        const overriddenConfig = utils.getOverriddenConfig(fakeTest, publicId, mockReporter, configOverride)

        expect(overriddenConfig.public_id).toBe(publicId)
        expect(overriddenConfig.executionRule).toBe(expectedExecutionRule)
      }

      const BLOCKING = ExecutionRule.BLOCKING
      const NON_BLOCKING = ExecutionRule.NON_BLOCKING
      const SKIPPED = ExecutionRule.SKIPPED

      // No override => nothing, let the backend decide
      expectHandledConfigToBe(undefined)

      // CI config overrides only
      expectHandledConfigToBe(BLOCKING, BLOCKING)
      expectHandledConfigToBe(NON_BLOCKING, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, SKIPPED)

      // Test config only => nothing, let the backend decide
      expectHandledConfigToBe(undefined, undefined, BLOCKING)
      expectHandledConfigToBe(undefined, undefined, NON_BLOCKING)
      expectHandledConfigToBe(undefined, undefined, SKIPPED)

      // Strictest executionRule is forwarded
      expectHandledConfigToBe(NON_BLOCKING, BLOCKING, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, SKIPPED, BLOCKING)
      expectHandledConfigToBe(SKIPPED, NON_BLOCKING, SKIPPED)
      expectHandledConfigToBe(SKIPPED, SKIPPED, NON_BLOCKING)
    })

    test('startUrl is not parsable', () => {
      const envVars = {...process.env}
      process.env = {CUSTOMVAR: '/newPath'}
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://{{ FAKE_VAR }}/path'}},
        public_id: publicId,
        type: 'browser',
      } as Test
      const configOverride = {
        startUrl: 'https://{{FAKE_VAR}}/newPath?oldPath={{CUSTOMVAR}}',
      }
      const expectedUrl = 'https://{{FAKE_VAR}}/newPath?oldPath=/newPath'
      const overriddenConfig = utils.getOverriddenConfig(fakeTest, publicId, mockReporter, configOverride)

      expect(overriddenConfig.public_id).toBe(publicId)
      expect(overriddenConfig.startUrl).toBe(expectedUrl)
      process.env = envVars
    })

    test('config overrides are applied', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://example.org/path'}},
        public_id: publicId,
        type: 'browser',
      } as Test
      const configOverride: UserConfigOverride = {
        allowInsecureCertificates: true,
        basicAuth: {username: 'user', password: 'password'},
        body: 'body',
        bodyType: 'application/json',
        cookies: 'name=value;',
        defaultStepTimeout: 15,
        deviceIds: ['device_id'],
        executionRule: ExecutionRule.NON_BLOCKING,
        followRedirects: true,
        headers: {'header-name': 'value'},
        locations: ['location'],
        pollingTimeout: 60 * 1000,
        retry: {count: 5, interval: 30},
        startUrl: 'http://127.0.0.1:60/newPath',
        startUrlSubstitutionRegex: '.*',
        testTimeout: 360,
        tunnel: {host: 'host', id: 'id', privateKey: 'privateKey'},
        variables: {VAR_1: 'value'},
      }

      expect(utils.getOverriddenConfig(fakeTest, publicId, mockReporter, configOverride)).toEqual({
        ...configOverride,
        public_id: publicId,
      })
    })
  })

  describe('getTestOverridesCount', () => {
    test('should count overrides', () => {
      expect(utils.getTestOverridesCount({})).toBe(0)

      // If the user sets anything, even an empty array or object, it counts as an override
      expect(utils.getTestOverridesCount({deviceIds: []})).toBe(1)
      expect(utils.getTestOverridesCount({headers: {}})).toBe(1)

      expect(utils.getTestOverridesCount({deviceIds: ['a']})).toBe(1)
      expect(utils.getTestOverridesCount({pollingTimeout: 123})).toBe(1)

      // Should ignore the default value for the pollingTimeout
      expect(utils.getTestOverridesCount({pollingTimeout: DEFAULT_POLLING_TIMEOUT})).toBe(0)
    })
  })

  describe('hasResultPassed (deprecated)', () => {
    test('complete result', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        passed: true,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, false, false, true)).toBe(true)
      expect(utils.hasResultPassed(result, false, true, true)).toBe(true)
      result.passed = false
      expect(utils.hasResultPassed(result, false, false, true)).toBe(false)
      expect(utils.hasResultPassed(result, false, true, true)).toBe(false)
    })

    test('result with error', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        failure: {
          code: 'ERRABORTED',
          message: 'Connection aborted',
        },
        passed: false,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, false, false, true)).toBe(false)
      expect(utils.hasResultPassed(result, false, true, true)).toBe(false)
    })

    test('result with unhealthy result', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        failure: {
          code: 'ERRABORTED',
          message: 'Connection aborted',
        },
        passed: false,
        startUrl: '',
        stepDetails: [],
        unhealthy: true,
      }
      expect(utils.hasResultPassed(result, false, false, true)).toBe(true)
      expect(utils.hasResultPassed(result, false, true, true)).toBe(false)
    })

    test('result with timeout result', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        passed: false,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, true, true, true)).toBe(false)
      expect(utils.hasResultPassed(result, true, true, false)).toBe(true)
    })
  })

  describe('getExecutionRule', () => {
    const cases: [ExecutionRule | undefined, ExecutionRule | undefined, ExecutionRule][] = [
      [undefined, undefined, ExecutionRule.BLOCKING],
      [undefined, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [undefined, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.BLOCKING, undefined, ExecutionRule.BLOCKING],
      [ExecutionRule.BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, undefined, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
    ]

    test.each(cases)(
      'execution rule: %s, result execution rule: %s. Expected rule: %s',
      (testRule, resultRule, expectedRule) => {
        const test = getApiTest('abc-def-ghi')

        expect(
          utils.getExecutionRule(
            testRule ? {...test, options: {...test.options, ci: {executionRule: testRule}}} : test,
            resultRule ? {executionRule: resultRule} : {}
          )
        ).toEqual(expectedRule)
      }
    )
  })

  describe('getResultOutcome', () => {
    const cases: [boolean, ExecutionRule, SelectiveRerunDecision | undefined, utils.ResultOutcome][] = [
      [true, ExecutionRule.BLOCKING, undefined, utils.ResultOutcome.Passed],
      [
        true,
        ExecutionRule.SKIPPED,
        {decision: 'skip', reason: 'passed', linked_result_id: ''},
        utils.ResultOutcome.PreviouslyPassed,
      ],
      [true, ExecutionRule.NON_BLOCKING, undefined, utils.ResultOutcome.PassedNonBlocking],
      [false, ExecutionRule.BLOCKING, undefined, utils.ResultOutcome.Failed],
      [false, ExecutionRule.NON_BLOCKING, undefined, utils.ResultOutcome.FailedNonBlocking],
    ]

    test.each(cases)(
      'Result passed: %s, execution rule: %s. Expected outcome: %s',
      (passed, resultRule, selectiveRerun, expectedOutcome) => {
        jest.spyOn(utils, 'getExecutionRule').mockReturnValue(resultRule)
        const test = getApiTest('abc-def-ghi')
        const result = getApiResult('1', test)
        result.executionRule = resultRule
        result.passed = passed
        result.selectiveRerun = selectiveRerun

        expect(utils.getResultOutcome(result)).toEqual(expectedOutcome)
      }
    )
  })

  describe('waitForResults', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      jest.spyOn(utils, 'wait').mockImplementation(async () => jest.advanceTimersByTime(5000))
    })

    afterEach(() => {
      jest.useRealTimers()
      jest.restoreAllMocks()
    })

    const batch: Batch = getBatch()
    const apiTest = getApiTest('pid')
    const result: Result = {
      executionRule: ExecutionRule.BLOCKING,
      initialResultId: undefined,
      isNonFinal: false,
      location: mockLocation.display_name,
      passed: true,
      result: getBrowserServerResult({passed: true}),
      resultId: 'rid',
      retries: 0,
      maxRetries: 0,
      selectiveRerun: undefined,
      test: apiTest,
      timedOut: false,
      timestamp: 0,
    }
    const pollResult: PollResult = {
      check: result.test,
      result: result.result,
      resultID: result.resultId,
      timestamp: result.timestamp,
    }
    const trigger = {batch_id: 'bid', locations: [mockLocation]}

    const mockApi = ({
      getBatchImplementation,
      pollResultsImplementation,
    }: {
      getBatchImplementation?(): Promise<Batch>
      pollResultsImplementation?(): Promise<PollResult[]>
    } = {}) => {
      const getBatchMock = jest
        .spyOn(api, 'getBatch')
        .mockImplementation(getBatchImplementation || (async () => deepExtend({}, batch)))

      const pollResultsMock = jest
        .spyOn(api, 'pollResults')
        .mockImplementation(pollResultsImplementation || (async () => [deepExtend({}, pollResult)]))

      return {getBatchMock, pollResultsMock}
    }

    const waiter: {
      promise: Promise<unknown>
      start: () => void
      resolve: (value?: unknown) => void
    } = {
      promise: Promise.resolve(),
      resolve: () => {},
      start() {
        this.promise = new Promise((resolve) => (this.resolve = resolve))
      },
    }

    test('should poll result ids', async () => {
      mockApi()

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 120000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result])
    })

    test('should show results as they arrive', async () => {
      jest.spyOn(utils, 'wait').mockImplementation(async () => waiter.resolve())

      const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

      // === STEP 1 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getInProgressResultInBatch()},
            {...getInProgressResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [deepExtend({}, pollResult)],
      })

      const resultsPromise = utils.waitForResults(
        api,
        trigger,
        tests,
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )

      // Wait for the 2 tests (initial)
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

      await waiter.promise

      // No results received
      expect(mockReporter.resultReceived).not.toHaveBeenCalled()
      expect(mockReporter.resultEnd).not.toHaveBeenCalled()
      // Still waiting for the 2 tests
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(
        2,
        [tests[0], tests[1]],
        MOCK_BASE_URL,
        trigger.batch_id,
        0
      )

      // === STEP 2 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getInProgressResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [
          deepExtend({}, pollResult),
          deepExtend({}, pollResult, {resultID: 'rid-2'}),
          deepExtend({}, pollResult, {resultID: 'rid-3'}),
        ],
      })

      await waiter.promise

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
        ...batch.results[0],
        status: 'passed',
        result_id: 'rid-2',
      })
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
      // Still waiting for 2 tests
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(
        3,
        [tests[0], tests[1]],
        MOCK_BASE_URL,
        trigger.batch_id,
        0
      )

      // === STEP 3 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getPassedResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [
          deepExtend({}, pollResult),
          deepExtend({}, pollResult, {resultID: 'rid-2'}),
          deepExtend({}, pollResult, {resultID: 'rid-3'}),
        ],
      })

      await waiter.promise

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
        ...batch.results[0],
        status: 'passed',
      })
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, result, MOCK_BASE_URL, 'bid')
      // Now waiting for 1 test
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(4, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

      // === STEP 4 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getPassedResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {
              ...getInProgressResultInBatch(), // stays in progress
              retries: 0, // `retries` is set => first attempt failed, but will be fast retried
              test_public_id: 'other-public-id',
              timed_out: false,
              result_id: 'rid-3',
            },
          ],
        }),
        pollResultsImplementation: async () => [
          deepExtend({}, pollResult),
          deepExtend({}, pollResult, {resultID: 'rid-2'}),
          deepExtend({}, pollResult, {resultID: 'rid-3'}),
        ],
      })

      await waiter.promise

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(3, {
        ...batch.results[0],
        status: 'in_progress',
        test_public_id: 'other-public-id',
        result_id: 'rid-3',
      })
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
        3,
        {...result, isNonFinal: true, resultId: 'rid-3', passed: false}, // the first attempt failed, so it's being retried
        MOCK_BASE_URL,
        'bid'
      )
      // Now waiting for 1 test
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(5, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

      // === STEP 5 === (batch 'passed')
      mockApi({
        getBatchImplementation: async () => ({
          status: 'passed',
          results: [
            // First test
            {...getPassedResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getPassedResultInBatch(), retries: 1, test_public_id: 'other-public-id', result_id: 'rid-3-final'},
          ],
        }),
        pollResultsImplementation: async () => [
          deepExtend({}, pollResult),
          deepExtend({}, pollResult, {resultID: 'rid-2'}),
          deepExtend({}, pollResult, {resultID: 'rid-3-final'}),
        ],
      })

      expect(await resultsPromise).toEqual([
        result,
        {...result, resultId: 'rid-2'},
        {...result, resultId: 'rid-3-final', retries: 1},
      ])

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(4, {
        ...batch.results[0],
        status: 'passed',
        test_public_id: 'other-public-id',
        result_id: 'rid-3-final',
        retries: 1,
      })
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
        4,
        {...result, resultId: 'rid-3-final', retries: 1},
        MOCK_BASE_URL,
        'bid'
      )
      // Do not report when there are no tests to wait anymore
      expect(mockReporter.testsWait).toHaveBeenCalledTimes(5)
    })

    test('skipped results are reported as received', async () => {
      jest.spyOn(utils, 'wait').mockImplementation(async () => waiter.resolve())

      const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

      // === STEP 1 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getSkippedResultInBatch()}, // skipped by selective re-run
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
          ],
        }),
        pollResultsImplementation: async () => [{...pollResult, resultID: 'rid-2'}],
      })

      const resultsPromise = utils.waitForResults(
        api,
        trigger,
        tests,
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )

      // Wait for the 2 tests (initial)
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

      await waiter.promise

      // The skipped result is received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
        ...getSkippedResultInBatch(),
      })
      // And marked as passed because it's selective re-run
      const skippedResult: Result = {
        executionRule: ExecutionRule.SKIPPED,
        passed: true,
        resultId: '123',
        selectiveRerun: {decision: 'skip', reason: 'passed', linked_result_id: '123'},
        test: result.test,
        timedOut: false,
      }
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, skippedResult, MOCK_BASE_URL, 'bid')
      // Now waiting for the remaining test
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(2, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 1)

      // === STEP 2 === (batch 'passed')
      mockApi({
        getBatchImplementation: async () => ({
          status: 'passed',
          results: [
            // First test
            {...getSkippedResultInBatch()},
            // Second test
            {...getPassedResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-2'},
          ],
        }),
        pollResultsImplementation: async () => [deepExtend({}, pollResult, {resultID: 'rid-2'})],
      })

      expect(await resultsPromise).toEqual([{...skippedResult}, {...result, resultId: 'rid-2'}])

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
        ...batch.results[0],
        status: 'passed',
        test_public_id: 'other-public-id',
        result_id: 'rid-2',
      })
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
      expect(mockReporter.testsWait).toHaveBeenCalledTimes(2)
    })

    test('should wait for incomplete results', async () => {
      jest.spyOn(utils, 'wait').mockImplementation(async () => waiter.resolve())

      const tests = [result.test, {...result.test, public_id: 'other-public-id'}]

      // === STEP 1 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getInProgressResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [
          {...pollResult, resultID: 'rid-2', result: getIncompleteServerResult()},
        ],
      })

      const resultsPromise = utils.waitForResults(
        api,
        trigger,
        tests,
        {
          batchTimeout: 120000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )

      // Wait for the 2 tests (initial)
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(1, [tests[0], tests[1]], MOCK_BASE_URL, trigger.batch_id)

      await waiter.promise

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(1, {
        ...batch.results[0],
        status: 'passed',
        result_id: 'rid-2',
      })
      // But the data from `/poll_results` data is not available yet, so we should wait more before reporting
      expect(mockReporter.resultEnd).not.toHaveBeenCalled()
      // Still waiting for 2 tests
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(
        2,
        [tests[0], tests[1]],
        MOCK_BASE_URL,
        trigger.batch_id,
        0
      )

      // === STEP 2 === (batch 'in_progress')
      waiter.start()
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            // First test
            {...getPassedResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getInProgressResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [
          {...pollResult, result: getIncompleteServerResult()}, // not available yet
          deepExtend({}, pollResult, {resultID: 'rid-2'}), // just became available
        ],
      })

      await waiter.promise

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(2, {
        ...batch.results[0],
        status: 'passed',
      })
      // Result 2 just became available, so it should be reported
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, {...result, resultId: 'rid-2'}, MOCK_BASE_URL, 'bid')
      // Now waiting for 1 test
      expect(mockReporter.testsWait).toHaveBeenNthCalledWith(3, [tests[1]], MOCK_BASE_URL, trigger.batch_id, 0)

      // === STEP 3 === (batch 'failed')
      mockApi({
        getBatchImplementation: async () => ({
          status: 'failed', // nothing to do with the fact that the result is incomplete
          results: [
            // First test
            {...getFailedResultInBatch()},
            {...getPassedResultInBatch(), result_id: 'rid-2'},
            // Second test
            {...getPassedResultInBatch(), test_public_id: 'other-public-id', result_id: 'rid-3'},
          ],
        }),
        pollResultsImplementation: async () => [
          {...pollResult, result: getIncompleteServerResult()}, // still not available
          deepExtend({}, pollResult, {resultID: 'rid-2'}),
          deepExtend({}, pollResult, {resultID: 'rid-3'}),
        ],
      })

      expect(await resultsPromise).toEqual([
        {...result, resultId: 'rid', passed: false, result: getIncompleteServerResult()},
        {...result, resultId: 'rid-2'},
        {...result, resultId: 'rid-3'},
      ])

      // One result received
      expect(mockReporter.resultReceived).toHaveBeenNthCalledWith(3, {
        ...batch.results[0],
        status: 'passed',
        test_public_id: 'other-public-id',
        result_id: 'rid-3',
      })
      // Result 3 was available instantly
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, {...result, resultId: 'rid-3'}, MOCK_BASE_URL, 'bid')

      // Result 1 never became available (but the batch says it did not pass)
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(
        3,
        {
          ...result,
          passed: false,
          resultId: 'rid',
          result: getIncompleteServerResult(),
        },
        MOCK_BASE_URL,
        'bid'
      )
      expect(mockReporter.error).toHaveBeenCalledWith(
        'The information for result rid of test pid was incomplete at the end of the batch.\n\n'
      )

      // Do not report when there are no tests to wait anymore
      expect(mockReporter.testsWait).toHaveBeenCalledTimes(3)
    })

    test('object in each result should be different even if they share the same public ID (config overrides)', async () => {
      mockApi({
        getBatchImplementation: async () => ({
          results: [getPassedResultInBatch(), {...getPassedResultInBatch(), result_id: '3'}],
          status: 'passed',
        }),
        pollResultsImplementation: async () => [
          deepExtend({}, pollResult),
          // The test object from the second result has an overridden start URL
          deepExtend({}, pollResult, {check: {config: {request: {url: 'https://reddit.com/'}}}, resultID: '3'}),
        ],
      })

      const results = await utils.waitForResults(
        api,
        trigger,
        [result.test, result.test],
        {
          batchTimeout: 0,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )

      expect(results.map(({test}) => test.config.request.url)).toEqual(['http://fake.url', 'https://reddit.com/'])
    })

    test('results should be timed out if the backend says so', async () => {
      mockApi({
        getBatchImplementation: async () => ({
          status: 'failed',
          results: [{...getPassedResultInBatch()}, {...getFailedResultInBatch(), result_id: '3', timed_out: true}],
        }),
        pollResultsImplementation: async () => [
          {...pollResult, result: {...pollResult.result}},
          {...pollResult, result: {...pollResult.result}, resultID: '3'},
        ],
      })

      const expectedTimeoutResult = {
        ...result,
        result: {
          ...result.result,
          failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
          passed: false,
        },
        resultId: '3',
        timedOut: true,
      }

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test, result.test],
          {
            batchTimeout: 3000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result, expectedTimeoutResult])

      expect(mockReporter.resultReceived).toHaveBeenCalledTimes(2)

      // `resultEnd` should return the same data as `waitForResults`
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, result, MOCK_BASE_URL, 'bid')
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, expectedTimeoutResult, MOCK_BASE_URL, 'bid')

      // Failed directly.
      expect(utils.wait).toHaveBeenCalledTimes(0)
    })

    test('results should be timed out with a different error if the backend did not say so', async () => {
      mockApi({
        getBatchImplementation: async () => ({
          status: 'in_progress',
          results: [
            {...getPassedResultInBatch()},
            {...getInProgressResultInBatch(), result_id: '3'}, // `timed_out: null`
          ],
        }),
        pollResultsImplementation: async () => [
          {...pollResult, result: {...pollResult.result}},
          {...pollResult, result: {...pollResult.result}, resultID: '3'},
        ],
      })

      const expectedDeadlineResult = {
        ...result,
        result: {
          ...result.result,
          failure: {
            code: 'BATCH_TIMEOUT_RUNAWAY',
            message: "The batch didn't timeout after the expected timeout period.",
          },
          passed: false,
        },
        resultId: '3',
        timedOut: true,
      }

      await expect(
        utils.waitForResults(
          api,
          trigger,
          [result.test, result.test],
          {
            batchTimeout: 3000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).rejects.toThrow(new BatchTimeoutRunawayError())

      // Residual results are never 'received': we force-end them.
      expect(mockReporter.resultReceived).toHaveBeenCalledTimes(1)

      // `resultEnd` should return the same data as `waitForResults`
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(1, result, MOCK_BASE_URL, 'bid')
      expect(mockReporter.resultEnd).toHaveBeenNthCalledWith(2, expectedDeadlineResult, MOCK_BASE_URL, 'bid')

      // Initial wait + 3 polling cycles.
      expect(utils.wait).toHaveBeenCalledTimes(4)
    })

    test('results failure should be ignored if timed out', async () => {
      // The original failure of a result received between timing out in batch poll
      // and retrieving it should be ignored in favor of timeout.
      mockApi({
        getBatchImplementation: async () => ({
          status: 'failed',
          results: [{...getFailedResultInBatch(), timed_out: true}],
        }),
        pollResultsImplementation: async () => [
          {
            ...pollResult,
            passed: false,
            result: {
              ...pollResult.result,
              failure: {code: 'FAILURE', message: 'Original failure, should be ignored'},
              passed: false,
            },
          },
        ],
      })

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 0,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toStrictEqual([
        {
          ...result,
          result: {
            ...result.result,
            failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
            passed: false,
          },
          timedOut: true,
        },
      ])
    })

    test('results should be timed out if batch result is timed out', async () => {
      const batchWithTimeoutResult: Batch = {
        ...batch,
        results: [{...getFailedResultInBatch(), timed_out: true}],
      }

      mockApi({getBatchImplementation: async () => batchWithTimeoutResult})

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 120000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([
        {
          ...result,
          result: {
            ...result.result,
            failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
            passed: false,
          },
          timedOut: true,
        },
      ])
    })

    test('wait between batch polling', async () => {
      const {getBatchMock} = mockApi({
        getBatchImplementation: async () => {
          return getBatchMock.mock.calls.length === 3 ? batch : {...batch, status: 'in_progress'}
        },
      })

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 120000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result])

      expect(getBatchMock).toHaveBeenCalledTimes(3)
      expect(utils.wait).toHaveBeenCalledTimes(2)
    })

    test('correct number of passed and timed out results', async () => {
      const pollTimeoutResult: PollResult = {...deepExtend({}, pollResult), resultID: 'another-id'}
      const batchWithTimeoutResult: Batch = {
        ...batch,
        results: [
          {...getPassedResultInBatch()},
          {...getFailedResultInBatch(), timed_out: true, result_id: pollTimeoutResult.resultID},
        ],
      }

      mockApi({
        getBatchImplementation: async () => batchWithTimeoutResult,
        pollResultsImplementation: async () => [pollResult, pollTimeoutResult],
      })

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 2000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            failOnTimeout: false,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([
        {
          ...result,
          passed: true,
          timedOut: false,
        },
        {
          ...result,
          passed: true, // because `failOnTimeout` is false
          timedOut: true,
          resultId: pollTimeoutResult.resultID,
          result: {
            ...result.result,
            failure: {
              code: 'TIMEOUT',
              message: 'The batch timed out before receiving the result.',
            },
            passed: false,
          },
        },
      ])

      expect(mockReporter.resultReceived).toHaveBeenCalledTimes(2)
      expect(mockReporter.resultEnd).toHaveBeenCalledTimes(2)
    })

    test('tunnel failure', async () => {
      mockApi()

      const mockTunnel = {
        keepAlive: async () => {
          throw new Error('keepAlive failed')
        },
      } as any

      await utils.waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )

      expect(mockReporter.error).toHaveBeenCalledWith(
        'The tunnel has stopped working, this may have affected the results.'
      )
    })

    test('location when tunnel', async () => {
      mockApi()

      const mockTunnel = {keepAlive: async () => true} as any

      let results = await utils.waitForResults(
        api,
        trigger,
        [result.test],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect((results[0] as BaseResult).location).toBe('Tunneled')

      const newTest = {...result.test}
      newTest.type = 'api'
      newTest.subtype = 'http'
      results = await utils.waitForResults(
        api,
        trigger,
        [newTest],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect((results[0] as BaseResult).location).toBe('Tunneled')

      newTest.type = 'api'
      newTest.subtype = 'ssl'
      results = await utils.waitForResults(
        api,
        trigger,
        [newTest],
        {
          batchTimeout: 2000,
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect((results[0] as BaseResult).location).toBe('Frankfurt (AWS)')
    })

    test('pollResults throws', async () => {
      const {pollResultsMock} = mockApi({
        pollResultsImplementation: () => {
          throw getAxiosError(502, {message: 'Poll results server error'})
        },
      })

      await expect(
        utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 2000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).rejects.toThrow(
        'Failed to poll results: could not query https://app.datadoghq.com/example\nPoll results server error\n'
      )

      expect(pollResultsMock).toHaveBeenCalledWith([result.resultId])
    })

    test('getBatch throws', async () => {
      const {getBatchMock} = mockApi({
        getBatchImplementation: () => {
          throw getAxiosError(502, {message: 'Get batch server error'})
        },
      })

      await expect(
        utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            batchTimeout: 2000,
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).rejects.toThrow(
        'Failed to get batch: could not query https://app.datadoghq.com/example\nGet batch server error\n'
      )

      expect(getBatchMock).toHaveBeenCalledWith(trigger.batch_id)
    })
  })

  test('getStrictestExecutionRule', () => {
    const BLOCKING = ExecutionRule.BLOCKING
    const NON_BLOCKING = ExecutionRule.NON_BLOCKING
    const SKIPPED = ExecutionRule.SKIPPED
    expect(utils.getStrictestExecutionRule(BLOCKING, NON_BLOCKING)).toBe(NON_BLOCKING)
    expect(utils.getStrictestExecutionRule(NON_BLOCKING, BLOCKING)).toBe(NON_BLOCKING)
    expect(utils.getStrictestExecutionRule(NON_BLOCKING, SKIPPED)).toBe(SKIPPED)
    expect(utils.getStrictestExecutionRule(BLOCKING, undefined)).toBe(BLOCKING)
    expect(utils.getStrictestExecutionRule(SKIPPED, undefined)).toBe(SKIPPED)
  })

  describe('retry', () => {
    test('retry works fine', async () => {
      const result = await utils.retry(
        async () => 42,
        () => 1
      )
      expect(result).toBe(42)
    })

    test('retry works fine after some retries', async () => {
      let counter = 0
      const start = +new Date()
      const result = await utils.retry(
        async () => {
          if (counter === 3) {
            return 42
          }
          counter += 1
          throw new Error('')
        },
        (retries: number) => 100 * (retries + 1)
      )
      const end = +new Date()
      const approximateWait = 100 + 100 * 2 + 100 * 3

      expect(result).toBe(42)
      expect(counter).toBe(3)
      expect(end - start - approximateWait < 50).toBeTruthy()
    })

    test('retry rethrows after some retries', async () => {
      let counter = 0

      await expect(
        utils.retry(
          async () => {
            counter += 1
            throw new Error('FAILURE')
          },
          (retries: number) => {
            if (retries < 2) {
              return 1
            }
          }
        )
      ).rejects.toThrow('FAILURE')
      expect(counter).toBe(3)
    })
  })

  test('parseVariablesFromCli', () => {
    const mockLogFunction = (message: string) => undefined
    expect(utils.parseVariablesFromCli(['TEST=42'], mockLogFunction)).toEqual({TEST: '42'})
    expect(utils.parseVariablesFromCli(['TEST=42 with some spaces'], mockLogFunction)).toEqual({
      TEST: '42 with some spaces',
    })
    expect(utils.parseVariablesFromCli(['TEST=42=43=44'], mockLogFunction)).toEqual({TEST: '42=43=44'})
    expect(utils.parseVariablesFromCli(['TEST='], mockLogFunction)).toEqual({TEST: ''})
    expect(utils.parseVariablesFromCli([''], mockLogFunction)).toBeUndefined()
    expect(utils.parseVariablesFromCli(undefined, mockLogFunction)).toBeUndefined()
  })

  describe('sortResultsByOutcome', () => {
    const results: Result[] = getResults([
      {executionRule: ExecutionRule.NON_BLOCKING, passed: false},
      {executionRule: ExecutionRule.BLOCKING, passed: true},
      {executionRule: ExecutionRule.BLOCKING, passed: false},
      {executionRule: ExecutionRule.NON_BLOCKING, passed: true},
    ])

    test('should sort tests with success, non_blocking failures then failures', async () => {
      const sortedResults = [...results]
      sortedResults.sort(utils.sortResultsByOutcome())
      expect(sortedResults.map((r) => r.resultId)).toStrictEqual(['3', '1', '0', '2'])
    })
  })

  describe('Render results', () => {
    const emptySummary = getSummary()

    const cases: RenderResultsTestCase[] = [
      {
        description: '1 API test with 1 config override, 1 result (passed)',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, expected: 1, passed: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([{passed: true}]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed timeout), no fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, expected: 1, passed: 1, timedOut: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([{timedOut: true}]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed timeout), fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 1,
          summary: {...emptySummary, expected: 1, failed: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: true,
        results: getResults([{timedOut: true}]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed critical error), no fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, expected: 1, passed: 1, criticalErrors: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([{unhealthy: true}]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed critical error), no fail on timeout, fail on critical errors',
        expected: {
          exitCode: 1,
          summary: {...emptySummary, expected: 1, criticalErrors: 0, failed: 1},
        },
        failOnCriticalErrors: true,
        failOnTimeout: false,
        results: getResults([{unhealthy: true}]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test (blocking) with 4 config overrides (1 skipped), 3 results (1 passed, 1 failed, 1 failed non-blocking)',
        expected: {
          exitCode: 1,
          summary: {
            ...emptySummary,
            expected: 3,
            failed: 1,
            failedNonBlocking: 1,
            passed: 1,
            skipped: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([{passed: true}, {executionRule: ExecutionRule.NON_BLOCKING}, {}]),
        summary: {...emptySummary, skipped: 1},
      },
      {
        description:
          '1 API test (non-blocking) with 4 config overrides (1 skipped), 3 results (1 passed, 1 failed, 1 failed non-blocking)',
        expected: {
          exitCode: 0,
          summary: {
            ...emptySummary,
            expected: 3,
            failedNonBlocking: 2,
            passed: 1,
            skipped: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([
          {
            executionRule: ExecutionRule.NON_BLOCKING,
            testExecutionRule: ExecutionRule.NON_BLOCKING,
          },
          {passed: true, testExecutionRule: ExecutionRule.NON_BLOCKING},
          {
            testExecutionRule: ExecutionRule.NON_BLOCKING,
          },
        ]),
        summary: {...emptySummary, skipped: 1},
      },
      {
        description:
          '3 API tests (blocking) with 1 config override each, 3 results (1 failed non-blocking, 1 failed, 1 passed)',
        expected: {
          exitCode: 1,
          summary: {
            ...emptySummary,
            expected: 3,
            failed: 1,
            failedNonBlocking: 1,
            passed: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([{}, {passed: true}, {executionRule: ExecutionRule.NON_BLOCKING}]),
        summary: {...emptySummary},
      },
      {
        description: '4 API tests, 3 results (2 passed, of which 1 comes from previous CI run, 1 skipped)',
        expected: {
          exitCode: 0,
          summary: {
            ...emptySummary,
            expected: 2,
            passed: 2,
            previouslyPassed: 1,
            skipped: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        results: getResults([
          {passed: true},
          {
            executionRule: ExecutionRule.SKIPPED,
            selectiveRerun: {decision: 'skip', reason: 'passed', linked_result_id: ''},
          },
        ]),
        summary: {...emptySummary, skipped: 1},
      },
    ]

    test.each(cases)('$description', async (testCase) => {
      testCase.results.forEach((result) => {
        result.passed = utils.hasResultPassed(
          (result as BaseResult).result,
          result.timedOut,
          testCase.failOnCriticalErrors,
          testCase.failOnTimeout
        )
      })

      jest.spyOn(api, 'getSyntheticsOrgSettings').mockResolvedValue({onDemandConcurrencyCap: 1})

      const config = {
        ...DEFAULT_COMMAND_CONFIG,
        failOnCriticalErrors: testCase.failOnCriticalErrors,
        failOnTimeout: testCase.failOnTimeout,
        appKey: 'appKey',
        apiKey: 'apiKey',
      }

      const startTime = Date.now()

      utils.renderResults({
        config,
        orgSettings: {onDemandConcurrencyCap: 1},
        reporter: mockReporter,
        results: testCase.results,
        startTime,
        summary: testCase.summary,
      })

      const exitCode = utils.toExitCode(utils.getExitReason(config, {results: testCase.results}))

      expect((mockReporter as MockedReporter).reportStart).toHaveBeenCalledWith({startTime})

      const baseUrl = `https://${DEFAULT_COMMAND_CONFIG.subdomain}.${DEFAULT_COMMAND_CONFIG.datadogSite}/`

      expect(testCase.summary).toEqual(testCase.expected.summary)
      expect((mockReporter as MockedReporter).runEnd).toHaveBeenCalledWith(testCase.expected.summary, baseUrl, {
        onDemandConcurrencyCap: 1,
      })

      expect(exitCode).toBe(testCase.expected.exitCode)
    })
  })

  describe('getExitReason', () => {
    test('should return failing-tests if any tests have failed', () => {
      const config = DEFAULT_COMMAND_CONFIG
      const results = getResults([{passed: false}])

      expect(utils.getExitReason(config, {results})).toBe('failing-tests')
    })

    test.each([
      {failOnMissingTests: true, errorCode: 'NO_TESTS_TO_RUN', expectedExitReason: 'missing-tests'},
      {failOnMissingTests: true, errorCode: 'MISSING_TESTS', expectedExitReason: 'missing-tests'},
      {failOnMissingTests: false, errorCode: 'NO_TESTS_TO_RUN', expectedExitReason: 'passed'},
      {failOnMissingTests: false, errorCode: 'MISSING_TESTS', expectedExitReason: 'passed'},
    ] as const)(
      'should return $expectedExitReason when $errorCode if failOnMissingTests flag is $failOnMissingTests',
      ({failOnMissingTests, errorCode, expectedExitReason: exitReason}) => {
        const config = {
          ...DEFAULT_COMMAND_CONFIG,
          failOnMissingTests,
        }
        const error = new CiError(errorCode)

        expect(utils.getExitReason(config, {error})).toBe(exitReason)
      }
    )

    test.each([
      {failOnCriticalErrorsFlag: true, exitReason: 'critical-error'},
      {failOnCriticalErrorsFlag: false, exitReason: 'passed'},
    ])(
      'should return $exitReason when failOnCriticalErrors flag is $failOnCriticalErrorsFlag',
      ({failOnCriticalErrorsFlag, exitReason}) => {
        const config = {
          ...DEFAULT_COMMAND_CONFIG,
          failOnCriticalErrors: failOnCriticalErrorsFlag,
        }
        const error = new CriticalError('AUTHORIZATION_ERROR')

        expect(utils.getExitReason(config, {error})).toBe(exitReason)
      }
    )

    test('should return passed if all tests have passed and there were no errors', () => {
      const config = DEFAULT_COMMAND_CONFIG
      const results = getResults([{passed: true}])

      expect(utils.getExitReason(config, {results})).toBe('passed')
    })
  })

  describe('getDatadogHost', () => {
    test('should default to datadog us api', async () => {
      process.env = {}

      expect(utils.getDatadogHost({useIntake: false, apiVersion: 'v1', config: ciConfig})).toBe(
        'https://api.datadoghq.com/api/v1'
      )
      expect(utils.getDatadogHost({useIntake: false, apiVersion: 'unstable', config: ciConfig})).toBe(
        'https://api.datadoghq.com/api/unstable'
      )
      expect(utils.getDatadogHost({useIntake: true, apiVersion: 'v1', config: ciConfig})).toBe(
        'https://intake.synthetics.datadoghq.com/api/v1'
      )
    })

    test('should use DD_API_HOST_OVERRIDE', async () => {
      process.env = {DD_API_HOST_OVERRIDE: 'https://foobar'}

      expect(utils.getDatadogHost({useIntake: true, apiVersion: 'v1', config: ciConfig})).toBe('https://foobar/api/v1')
      expect(utils.getDatadogHost({useIntake: true, apiVersion: 'v1', config: ciConfig})).toBe('https://foobar/api/v1')
    })

    test('should use Synthetics intake endpoint', async () => {
      process.env = {}

      expect(
        utils.getDatadogHost({
          apiVersion: 'v1',
          config: {...ciConfig, datadogSite: 'datadoghq.com' as string},
          useIntake: true,
        })
      ).toBe('https://intake.synthetics.datadoghq.com/api/v1')
      expect(
        utils.getDatadogHost({
          apiVersion: 'v1',
          config: {...ciConfig, datadogSite: 'datad0g.com' as string},
          useIntake: true,
        })
      ).toBe('https://intake.synthetics.datad0g.com/api/v1')
    })
  })

  describe('getSyntheticsOrgSettings', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('failing to get org settings is not important enough to throw', async () => {
      jest.spyOn(api, 'getSyntheticsOrgSettings').mockImplementation(() => {
        throw getAxiosError(502, {message: 'Server Error'})
      })

      const config = (apiConfiguration as unknown) as SyntheticsCIConfig
      expect(await utils.getOrgSettings(mockReporter, config)).toBeUndefined()
    })
  })

  describe('reportCiError', () => {
    test.each([
      'NO_TESTS_TO_RUN',
      'MISSING_TESTS',
      'AUTHORIZATION_ERROR',
      'INVALID_CONFIG',
      'MISSING_APP_KEY',
      'MISSING_API_KEY',
      'POLL_RESULTS_FAILED',
      'TUNNEL_START_FAILED',
      'TOO_MANY_TESTS_TO_TRIGGER',
      'TRIGGER_TESTS_FAILED',
      'UNAVAILABLE_TEST_CONFIG',
      'UNAVAILABLE_TUNNEL_CONFIG',
    ] as const)('should report %s error', async (errorCode) => {
      const error = new CiError(errorCode)
      utils.reportCiError(error, mockReporter)
      expect(mockReporter.error).toMatchSnapshot()
    })

    test('should report default Error if no CiError was matched', async () => {
      const error = new CiError('ERROR' as CiErrorCode)
      utils.reportCiError(error, mockReporter)
      expect(mockReporter.error).toMatchSnapshot()
    })
  })
})
