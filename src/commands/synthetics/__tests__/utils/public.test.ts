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

import glob from 'glob'

import {getAxiosError} from '../../../../helpers/__tests__/fixtures'
import * as ciUtils from '../../../../helpers/utils'

import {apiConstructor} from '../../api'
import {CiError, CiErrorCode, CriticalError} from '../../errors'
import {
  ExecutionRule,
  RemoteTestPayload,
  Result,
  SelectiveRerunDecision,
  SyntheticsCIConfig,
  Test,
  UserConfigOverride,
} from '../../interfaces'
import {DEFAULT_COMMAND_CONFIG} from '../../run-tests-command'
import * as utils from '../../utils/public'

import {
  ciConfig,
  getApiResult,
  getApiTest,
  getResults,
  getSummary,
  MockedReporter,
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

  describe('makeTestPayload', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi'
      expect(utils.makeTestPayload({public_id: publicId} as Test, {id: publicId}, publicId)).toEqual({
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

        const testOverrides = configExecutionRule ? {executionRule: configExecutionRule} : undefined

        const overriddenConfig = utils.makeTestPayload(
          fakeTest,
          {id: publicId, testOverrides},
          publicId
        ) as RemoteTestPayload

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
      const testOverrides = {
        startUrl: 'https://{{FAKE_VAR}}/newPath?oldPath={{CUSTOMVAR}}',
      }
      const expectedUrl = 'https://{{FAKE_VAR}}/newPath?oldPath=/newPath'
      const overriddenConfig = utils.makeTestPayload(
        fakeTest,
        {id: publicId, testOverrides},
        publicId
      ) as RemoteTestPayload

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
      const testOverrides: UserConfigOverride = {
        allowInsecureCertificates: true,
        basicAuth: {username: 'user', password: 'password'},
        body: 'body',
        bodyType: 'application/json',
        cookies: 'name=value;',
        setCookies: 'name=value \n name2=value2; Secure',
        defaultStepTimeout: 15,
        deviceIds: ['device_id'],
        executionRule: ExecutionRule.NON_BLOCKING,
        followRedirects: true,
        headers: {'header-name': 'value'},
        locations: ['location'],
        retry: {count: 5, interval: 30},
        startUrl: 'http://127.0.0.1:60/newPath',
        startUrlSubstitutionRegex: '.*',
        testTimeout: 360,
        tunnel: {host: 'host', id: 'id', privateKey: 'privateKey'},
        variables: {VAR_1: 'value'},
      }

      expect(utils.makeTestPayload(fakeTest, {id: publicId, testOverrides}, publicId)).toEqual({
        ...testOverrides,
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
        results: getResults([{timedOut: true, passed: true}]),
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
        results: getResults([{timedOut: true, passed: false}]),
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
        results: getResults([{unhealthy: true, passed: true}]),
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
        results: getResults([{unhealthy: true, passed: false}]),
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
