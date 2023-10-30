jest.mock('glob')
jest.mock('fs')
jest.mock('child_process')
jest.unmock('chalk')

jest.mock('path', () => {
  const actualPath = jest.requireActual('path')

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

import {default as axios} from 'axios'
import deepExtend from 'deep-extend'
import glob from 'glob'

process.env.DATADOG_SYNTHETICS_CI_TRIGGER_APP = 'env_default'

import * as ciHelpers from '../../../helpers/ci'
import {Metadata} from '../../../helpers/interfaces'
import * as ciUtils from '../../../helpers/utils'

import {apiConstructor, APIHelper} from '../api'
import {CiError} from '../errors'
import {
  Batch,
  ExecutionRule,
  PollResult,
  Result,
  ServerResult,
  SyntheticsCIConfig,
  Test,
  Trigger,
  UserConfigOverride,
} from '../interfaces'
import * as mobile from '../mobile'
import {DEFAULT_COMMAND_CONFIG, MAX_TESTS_TO_TRIGGER} from '../run-tests-command'
import * as utils from '../utils'

import {
  ciConfig,
  getApiResult,
  getApiTest,
  getAxiosHttpError,
  getBatch,
  getBrowserServerResult,
  getResults,
  getSummary,
  MockedReporter,
  mockLocation,
  mockReporter,
  RenderResultsTestCase,
} from './fixtures'

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
        throw getAxiosHttpError(502, {message: 'Server Error'})
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

        throw getAxiosHttpError(404, {errors: ['Not found']})
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
      expect(overriddenTestsToTrigger).toStrictEqual([
        {executionRule: ExecutionRule.BLOCKING, public_id: '123-456-789'},
        {executionRule: ExecutionRule.SKIPPED, public_id: 'ski-ppe-d01'},
      ])

      const expectedSummary: utils.InitialSummary = {
        criticalErrors: 0,
        failed: 0,
        failedNonBlocking: 0,
        passed: 0,
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
      const spy = jest.spyOn(mobile, 'uploadApplicationAndOverrideConfig').mockImplementation()
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
        throw getAxiosHttpError(403, {message: 'Forbidden'})
      }) as any)

      const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}

      await expect(() =>
        utils.getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())
      ).rejects.toThrow('Failed to get test: could not query https://app.datadoghq.com/example\nForbidden\n')
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

  describe('getOverriddenConfig', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi'
      expect(utils.getOverriddenConfig({public_id: publicId} as Test, publicId, mockReporter)).toEqual({
        executionRule: ExecutionRule.BLOCKING,
        public_id: publicId,
      })
    })

    test('strictest executionRule is forwarded', () => {
      const expectHandledConfigToBe = (
        expectedExecutionRule: ExecutionRule,
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

        expect(utils.getExecutionRule(fakeTest, configOverride)).toBe(expectedExecutionRule)

        const overriddenConfig = utils.getOverriddenConfig(fakeTest, publicId, mockReporter, configOverride)

        expect(overriddenConfig.public_id).toBe(publicId)
        expect(overriddenConfig.executionRule).toBe(expectedExecutionRule)
      }

      const BLOCKING = ExecutionRule.BLOCKING
      const NON_BLOCKING = ExecutionRule.NON_BLOCKING
      const SKIPPED = ExecutionRule.SKIPPED

      // No override => BLOCKING
      expectHandledConfigToBe(BLOCKING)

      // CI config overrides only
      expectHandledConfigToBe(BLOCKING, BLOCKING)
      expectHandledConfigToBe(NON_BLOCKING, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, SKIPPED)

      // Test config only
      expectHandledConfigToBe(BLOCKING, undefined, BLOCKING)
      expectHandledConfigToBe(NON_BLOCKING, undefined, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, undefined, SKIPPED)

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

  describe('hasResultPassed', () => {
    test('complete result', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        passed: true,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, false, false, true)).toBeTruthy()
      expect(utils.hasResultPassed(result, false, true, true)).toBeTruthy()
      result.passed = false
      expect(utils.hasResultPassed(result, false, false, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, false, true, true)).toBeFalsy()
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
      expect(utils.hasResultPassed(result, false, false, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, false, true, true)).toBeFalsy()
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
      expect(utils.hasResultPassed(result, false, false, true)).toBeTruthy()
      expect(utils.hasResultPassed(result, false, true, true)).toBeFalsy()
    })

    test('result with timeout result', () => {
      const result: ServerResult = {
        device: {height: 1100, id: 'chrome.laptop_large', width: 1440},
        duration: 0,
        passed: false,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, true, true, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, true, true, false)).toBeTruthy()
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
    const cases: [boolean, ExecutionRule, utils.ResultOutcome][] = [
      [true, ExecutionRule.BLOCKING, utils.ResultOutcome.Passed],
      [true, ExecutionRule.NON_BLOCKING, utils.ResultOutcome.PassedNonBlocking],
      [false, ExecutionRule.BLOCKING, utils.ResultOutcome.Failed],
      [false, ExecutionRule.NON_BLOCKING, utils.ResultOutcome.FailedNonBlocking],
    ]
    test.each(cases)(
      'Result passed: %s, execution rule: %s. Expected outcome: %s',
      (resultPassed, resultRule, expectedOutcome) => {
        jest.spyOn(utils, 'getExecutionRule').mockReturnValue(resultRule)
        const test = getApiTest('abc-def-ghi')
        const result = getApiResult('1', test)
        result.executionRule = resultRule
        result.passed = resultPassed

        expect(utils.getResultOutcome(result)).toEqual(expectedOutcome)
      }
    )
  })

  describe('waitForResults', () => {
    beforeAll(() => {
      // We still wait a few milliseconds to avoid the test going crazy on a infinite loop
      // if case of mistakes in the code or test.
      jest.spyOn(utils, 'wait').mockImplementation(() => new Promise((r) => setTimeout(r, 10)))
    })

    const batch: Batch = getBatch()
    const apiTest = getApiTest(batch.results[0].test_public_id)
    const result: Result = {
      executionRule: ExecutionRule.BLOCKING,
      location: mockLocation.display_name,
      passed: true,
      result: getBrowserServerResult({passed: true}),
      resultId: batch.results[0].result_id,
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
        .mockImplementation(getBatchImplementation || (async () => JSON.parse(JSON.stringify(batch))))

      const pollResultsMock = jest
        .spyOn(api, 'pollResults')
        .mockImplementation(pollResultsImplementation || (async () => JSON.parse(JSON.stringify([pollResult]))))

      return {getBatchMock, pollResultsMock}
    }

    test('should poll result ids', async () => {
      mockApi()

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 120000,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result])

      expect(mockReporter.resultReceived).toHaveBeenCalledWith(batch.results[0])
    })

    test('object in each result should be different even if they share the same public ID (config overrides)', async () => {
      mockApi({
        getBatchImplementation: async () => ({
          results: [batch.results[0], {...batch.results[0], result_id: '3'}],
          status: 'in_progress',
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
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: false,
          maxPollingTimeout: 0,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter
      )

      expect(results.map(({test}) => test.config.request.url)).toEqual(['http://fake.url', 'https://reddit.com/'])
    })

    test('results should be timed out if global pollingTimeout is exceeded', async () => {
      mockApi({
        getBatchImplementation: async () => ({
          results: [batch.results[0], {...batch.results[0], result_id: '3', timed_out: undefined}],
          status: 'in_progress',
        }),
        pollResultsImplementation: async () => [
          {...pollResult, result: {...pollResult.result}},
          {...pollResult, result: {...pollResult.result}, resultID: '3'},
        ],
      })

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test, result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 0,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([
        result,
        {
          ...result,
          result: {
            ...result.result,
            failure: {code: 'TIMEOUT', message: 'Result timed out'},
            passed: false,
          },
          resultId: '3',
          timedOut: true,
        },
      ])
    })

    test('results failure should ignore if timed-out', async () => {
      // The original failure of a result received between timing-out in batch poll
      // and retrieving it should be ignored in favor of timeout.
      mockApi({
        getBatchImplementation: async () => ({
          results: [{...batch.results[0], timed_out: undefined}],
          status: 'in_progress',
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
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 0,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toStrictEqual([
        {
          ...result,
          result: {...result.result, failure: {code: 'TIMEOUT', message: 'Result timed out'}, passed: false},
          timedOut: true,
        },
      ])
    })

    test('results should be timed out if batch result is timed out', async () => {
      const batchWithTimeoutResult: Batch = {
        ...batch,
        results: [{...batch.results[0], timed_out: true}],
      }

      mockApi({getBatchImplementation: async () => batchWithTimeoutResult})

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 120000,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([
        {
          ...result,
          result: {...result.result, failure: {code: 'TIMEOUT', message: 'Result timed out'}, passed: false},
          timedOut: true,
        },
      ])
    })

    test('wait between batch polling', async () => {
      const waitMock = jest.spyOn(utils, 'wait').mockImplementation(() => new Promise((r) => setTimeout(r, 10)))

      let counter = 0

      mockApi({
        getBatchImplementation: async () => {
          counter += 1

          return counter === 3 ? batch : {...batch, status: 'in_progress'}
        },
      })

      expect(
        await utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 120000,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result])

      expect(counter).toBe(3)
      expect(waitMock).toHaveBeenCalledTimes(2)
    })

    test('correct number of pass and timeout results', async () => {
      const pollTimeoutResult: PollResult = {...pollResult, resultID: 'another-id'}
      const batchWithTimeoutResult: Batch = {
        ...batch,
        results: [batch.results[0], {...batch.results[0], timed_out: true, result_id: pollTimeoutResult.resultID}],
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
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            failOnCriticalErrors: false,
            maxPollingTimeout: 2000,
            subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
          },
          mockReporter
        )
      ).toEqual([result, {...result, resultId: pollTimeoutResult.resultID, timedOut: true}])
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
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          maxPollingTimeout: 2000,
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
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          maxPollingTimeout: 2000,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect(results[0].location).toBe('Tunneled')

      const newTest = {...result.test}
      newTest.type = 'api'
      newTest.subtype = 'http'
      results = await utils.waitForResults(
        api,
        trigger,
        [newTest],
        {
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          maxPollingTimeout: 2000,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect(results[0].location).toBe('Tunneled')

      newTest.type = 'api'
      newTest.subtype = 'ssl'
      results = await utils.waitForResults(
        api,
        trigger,
        [newTest],
        {
          datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
          failOnCriticalErrors: true,
          maxPollingTimeout: 2000,
          subdomain: DEFAULT_COMMAND_CONFIG.subdomain,
        },
        mockReporter,
        mockTunnel
      )
      expect(results[0].location).toBe('Frankfurt (AWS)')
    })

    test('pollResults throws', async () => {
      const {pollResultsMock} = mockApi({
        pollResultsImplementation: () => {
          throw getAxiosHttpError(502, {message: 'Poll results server error'})
        },
      })

      await expect(
        utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            maxPollingTimeout: 2000,
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
          throw getAxiosHttpError(502, {message: 'Get batch server error'})
        },
      })

      await expect(
        utils.waitForResults(
          api,
          trigger,
          [result.test],
          {
            datadogSite: DEFAULT_COMMAND_CONFIG.datadogSite,
            maxPollingTimeout: 2000,
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
          summary: {...emptySummary, passed: 1},
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
          summary: {...emptySummary, passed: 1, timedOut: 1},
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
          summary: {...emptySummary, failed: 1},
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
          summary: {...emptySummary, passed: 1, criticalErrors: 1},
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
          summary: {...emptySummary, criticalErrors: 0, failed: 1},
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
    ]

    test.each(cases)('$description', async (testCase) => {
      testCase.results.forEach(
        (result) =>
          (result.passed = utils.hasResultPassed(
            result.result,
            result.timedOut,
            testCase.failOnCriticalErrors,
            testCase.failOnTimeout
          ))
      )

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
      expect((mockReporter as MockedReporter).resultEnd).toHaveBeenCalledTimes(testCase.results.length)

      const baseUrl = `https://${DEFAULT_COMMAND_CONFIG.subdomain}.${DEFAULT_COMMAND_CONFIG.datadogSite}/`
      for (const result of testCase.results) {
        expect((mockReporter as MockedReporter).resultEnd).toHaveBeenCalledWith(result, baseUrl)
      }

      expect(testCase.summary).toEqual(testCase.expected.summary)
      expect((mockReporter as MockedReporter).runEnd).toHaveBeenCalledWith(testCase.expected.summary, baseUrl, {
        onDemandConcurrencyCap: 1,
      })

      expect(exitCode).toBe(testCase.expected.exitCode)
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
        throw getAxiosHttpError(502, {message: 'Server Error'})
      })

      const config = (apiConfiguration as unknown) as SyntheticsCIConfig
      expect(await utils.getOrgSettings(mockReporter, config)).toBeUndefined()
    })
  })
})
