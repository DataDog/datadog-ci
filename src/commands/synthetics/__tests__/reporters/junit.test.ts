import fs from 'fs'
import fsp from 'fs/promises'
import {Writable} from 'stream'

import {BaseContext} from 'clipanion'

import {MOCK_BASE_URL} from '../../../../helpers/__tests__/testing-tools'

import {Device, ExecutionRule, Result, ServerTest} from '../../interfaces'
import {Args, getDefaultSuiteStats, getDefaultTestCaseStats, JUnitReporter, XMLTestCase} from '../../reporters/junit'
import {RunTestsCommand} from '../../run-tests-command'

import {
  BATCH_ID,
  getApiResult,
  getApiServerResult,
  getApiTest,
  getBrowserResult,
  getBrowserServerResult,
  getBrowserTest,
  getFailedBrowserResult,
  getFailedMultiStepsServerResult,
  getFailedMultiStepsTestLevelServerResult,
  getMultiStep,
  getMultiStepsServerResult,
  getStep,
  getSummary,
} from '../fixtures'

const globalApiTestMock = getApiTest('123-456-789')
const globalBrowserTestMock = getBrowserTest('123-456-789')
const globalStepMock = getStep()
const globalApiResultMock = getApiResult('1', globalApiTestMock)
const globalBrowserResultMock = getBrowserResult('1', globalBrowserTestMock)
const globalSummaryMock = getSummary()

describe('Junit reporter', () => {
  const writeMock: Writable['write'] = jest.fn()
  const commandMock: Args = {
    context: ({stdout: {write: writeMock}} as unknown) as BaseContext,
    jUnitReport: 'junit',
    runName: 'Custom run name',
  }

  let reporter: JUnitReporter

  describe('constructor', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestsCommand)
    })

    it("should append '.xml' to destination if isn't there", () => {
      expect(reporter['destination']).toBe('junit.xml')
    })

    it('should give a default run name', () => {
      expect(new JUnitReporter({...commandMock, runName: undefined})['json'].testsuites.$.name).toBe('Undefined run')
    })
  })

  describe('runEnd', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestsCommand)
      jest.spyOn(fs, 'writeFileSync')
      jest.spyOn(reporter['builder'], 'buildObject')
    })

    it('should build the xml', async () => {
      reporter.runEnd(globalSummaryMock, '')
      expect(reporter['builder'].buildObject).toHaveBeenCalledWith(reporter['json'])
      expect(fs.writeFileSync).toHaveBeenCalledWith('junit.xml', expect.any(String), 'utf8')
      expect(writeMock).toHaveBeenCalledTimes(1)

      // Cleaning
      await fsp.unlink(reporter['destination'])
    })

    it('should gracefully fail', async () => {
      jest.spyOn(reporter['builder'], 'buildObject').mockImplementation(() => {
        throw new Error('Fail')
      })

      reporter.runEnd(globalSummaryMock, '')

      expect(fs.writeFileSync).not.toHaveBeenCalled()
      expect(writeMock).toHaveBeenCalledTimes(1)
    })

    it('should create the file', async () => {
      reporter['destination'] = 'junit/report.xml'
      reporter.runEnd(globalSummaryMock, '')
      const stat = await fsp.stat(reporter['destination'])
      expect(stat).toBeDefined()

      // Cleaning
      await fsp.unlink(reporter['destination'])
      await fsp.rmdir('junit')
    })

    it('should not throw on existing directory', async () => {
      await fsp.mkdir('junit')
      reporter['destination'] = 'junit/report.xml'
      reporter.runEnd(globalSummaryMock, '')

      // Cleaning
      await fsp.unlink(reporter['destination'])
      await fsp.rmdir('junit')
    })

    it('testsuites contains summary properties', async () => {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

      reporter.runEnd(
        {
          ...globalSummaryMock,
          criticalErrors: 1,
          failed: 2,
          failedNonBlocking: 3,
          passed: 4,
          skipped: 5,
          testsNotFound: new Set(['a', 'b', 'c']),
          timedOut: 6,
        },
        MOCK_BASE_URL
      )
      expect(reporter['json'].testsuites.$).toStrictEqual({
        batch_id: BATCH_ID,
        batch_url: `${MOCK_BASE_URL}synthetics/explorer/ci?batchResultId=${BATCH_ID}`,
        name: 'Custom run name',
        tests_critical_error: 1,
        tests_failed: 2,
        tests_failed_non_blocking: 3,
        tests_not_authorized: 0,
        tests_not_found: 3,
        tests_passed: 4,
        tests_skipped: 5,
        tests_timed_out: 6,
      })
    })
  })

  describe('resultEnd', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestsCommand)
    })

    it('should give a default suite name', () => {
      reporter.resultEnd(globalApiResultMock, '', '')
      const testsuite = reporter['json'].testsuites.testsuite[0]
      expect(testsuite.$.name).toBe('Undefined suite')
    })

    it('should use the same report for tests from same suite', () => {
      const results = [
        {...globalApiResultMock, test: {...globalApiTestMock, suite: 'same suite'}},
        {...globalApiResultMock, test: {...globalApiTestMock, suite: 'same suite'}},
      ]

      results.forEach((result) => reporter.resultEnd(result, '', ''))

      // We should have 1 unique report. Not 2 different ones.
      expect(reporter['json'].testsuites.testsuite.length).toBe(1)

      // And this unique report should include the 2 tests.
      expect(reporter['json'].testsuites.testsuite[0].$).toMatchObject({
        ...getDefaultSuiteStats(),
        tests: 2,
      })
    })

    it('should add stats to the run', () => {
      reporter.resultEnd({...globalApiResultMock, test: {...globalApiTestMock, suite: 'suite 1'}}, '', '')

      reporter.testTrigger({...globalApiTestMock, suite: 'suite 2'}, '', ExecutionRule.SKIPPED, {})
      reporter.resultEnd(
        {
          ...globalApiResultMock,
          passed: false,
          result: getFailedMultiStepsServerResult(),
          test: {
            ...globalApiTestMock,
            suite: 'suite 2',
          },
        },
        '',
        ''
      )
      reporter.resultEnd(
        {
          executionRule: ExecutionRule.SKIPPED,
          passed: true,
          resultId: '123',
          selectiveRerun: {decision: 'skip', reason: 'passed', linked_result_id: '123'},
          test: {
            ...globalApiTestMock,
            suite: 'suite 2',
          },
          timedOut: false,
        },
        '',
        ''
      )

      const [suitePassed, suiteFailed] = reporter['json'].testsuites.testsuite

      expect(suitePassed.$).toMatchObject({
        ...getDefaultSuiteStats(),
        tests: 1,
      })
      expect(suiteFailed.$).toMatchObject({
        ...getDefaultSuiteStats(),
        errors: 0,
        failures: 1,
        skipped: 1, // not 2 because skipped by selective rerun counts as passed
        tests: 3,
      })
    })

    it('should fall back to a test level failure', () => {
      reporter.resultEnd(
        {
          ...globalApiResultMock,
          passed: false,
          result: getFailedMultiStepsTestLevelServerResult(),
          test: {
            ...globalApiTestMock,
            suite: 'suite 1',
          },
        },
        '',
        ''
      )

      const [suiteFailed] = reporter['json'].testsuites.testsuite

      expect(suiteFailed.$).toMatchObject({
        ...getDefaultSuiteStats(),
        errors: 0,
        failures: 1,
        tests: 1,
      })
    })

    it('should report errors', () => {
      const browserResult1: Result = {
        ...globalBrowserResultMock,
        result: {
          ...getBrowserServerResult(),
          steps: [
            {
              ...getStep(),
              allow_failure: true,
              browser_errors: [
                {
                  description: 'error description',
                  name: 'error name',
                  type: 'error type',
                },
                {
                  description: 'error description',
                  name: 'error name',
                  type: 'error type',
                },
              ],
              failure: {message: 'error'},
              warnings: [
                {
                  message: 'warning message',
                  type: 'warning type',
                },
              ],
            },
            getStep(),
          ],
        },
      }
      const browserResult2: Result = {
        ...globalBrowserResultMock,
        result: getBrowserServerResult(),
      }
      const browserResult3: Result = {
        ...globalBrowserResultMock,
        result: {
          ...getBrowserServerResult(),
          failure: {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'},
        },
        timedOut: true,
      }
      const apiResult: Result = {
        ...globalApiResultMock,
        result: {
          ...getMultiStepsServerResult(),
          steps: [
            {
              ...getMultiStep(),
              failure: {
                code: '1',
                message: 'message',
              },
            },
          ],
        },
      }
      reporter.resultEnd(browserResult1, '', '')
      reporter.resultEnd(browserResult2, '', '')
      reporter.resultEnd(browserResult3, '', '')
      reporter.resultEnd(apiResult, '', '')
      const testsuite = reporter['json'].testsuites.testsuite[0]
      const results = [
        [1, 2, 0, 1],
        [0, 0, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 0],
      ]
      const entries: [any, XMLTestCase][] = Object.entries(testsuite.testcase)
      for (const [i, testcase] of entries) {
        const result = results[i]
        expect(testcase.allowed_error.length).toBe(result[0])
        expect(testcase.browser_error.length).toBe(result[1])
        expect(testcase.failure.length).toBe(result[2])
        expect(testcase.warning.length).toBe(result[3])
      }
    })
  })

  describe('getTestCase', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestsCommand)
    })

    it('should add stats to the test case - api test', () => {
      const resultMock = {
        ...globalApiResultMock,
        result: getApiServerResult({status: 'failed'}),
      }
      const testCase = reporter['getTestCase'](resultMock, '', '')
      expect(testCase.$).toMatchObject({
        ...getDefaultTestCaseStats(),
        steps_count: 1,
        steps_errors: 1,
        steps_failures: 1,
      })
    })

    it('should add stats to the test case - multistep test', () => {
      const resultMock = {
        ...globalBrowserResultMock,
        result: getFailedMultiStepsServerResult(),
      }
      const testCase = reporter['getTestCase'](resultMock, '', '')
      expect(testCase.$).toMatchObject({
        ...getDefaultTestCaseStats(),
        steps_allowfailures: 1,
        steps_count: 4,
        steps_errors: 2,
        steps_failures: 2,
        steps_skipped: 1,
      })
    })

    it('should add stats to the test case - browser test', () => {
      const resultMock = {
        ...globalBrowserResultMock,
        result: {
          ...globalBrowserResultMock.result,
          start_url: 'https://example.com',
          steps: [
            globalStepMock,
            {
              ...globalStepMock,
              browser_errors: [{type: 'error', name: 'Error', description: 'Description'}],
              failure: {message: 'Error'},
              sub_test_step_details: [globalStepMock],
              warnings: [{type: 'warning', message: 'Warning'}],
            },
          ],
        },
      }
      const testCase = reporter['getTestCase'](resultMock, '', '')
      expect(testCase.$).toMatchObject({
        ...getDefaultTestCaseStats(),
        steps_count: 3,
        steps_errors: 2,
        steps_failures: 1,
        steps_warnings: 1,
      })
    })
  })
})

describe('GitLab test report compatibility', () => {
  const writeMock: Writable['write'] = jest.fn()
  const commandMock: Args = {
    context: ({stdout: {write: writeMock}} as unknown) as BaseContext,
    jUnitReport: 'junit',
    runName: 'Custom run name',
  }

  let reporter: JUnitReporter

  beforeEach(() => {
    reporter = new JUnitReporter(commandMock as RunTestsCommand)
  })

  test('all test case names are unique', () => {
    const locations = ['aws:eu-central-1', 'aws:eu-central-2']
    const devices: Record<string, Device> = {
      chrome: {
        id: 'chrome.laptop_large',
        resolution: {height: 1100, width: 1440},
      },
      firefox: {
        id: 'firefox.laptop_large',
        resolution: {height: 1100, width: 1440},
      },
    }

    const apiTest = getApiTest('aaa-aaa-aaa', {locations})
    const browserTest = getBrowserTest('bbb-bbb-bbb', [devices.chrome.id, devices.firefox.id], {locations})

    const getTestCase = (
      test: ServerTest,
      resultId: string,
      {
        device,
        location,
        timedOut,
      }: {
        device?: Device
        location?: string
        timedOut?: boolean
      }
    ): XMLTestCase =>
      reporter['getTestCase'](
        {
          ...(test.type === 'browser' ? getBrowserResult(resultId, test) : getApiResult(resultId, test)),
          ...(device && {device}),
          ...(location && {location}),
          ...(timedOut && {timedOut}),
        },
        '',
        ''
      )

    const testCases = [
      // API test, location 1
      getTestCase(apiTest, '1', {location: locations[0]}),
      // API test, location 2
      getTestCase(apiTest, '2', {location: locations[1]}),
      // API test, location 1 (timed out)
      getTestCase(apiTest, '3', {location: locations[0], timedOut: true}),
      // API test, location 2 (timed out)
      getTestCase(apiTest, '4', {location: locations[1], timedOut: true}),

      // Browser test, location 1, device 1
      getTestCase(browserTest, '5', {device: devices.chrome, location: locations[0]}),
      // Browser test, location 1, device 2
      getTestCase(browserTest, '6', {device: devices.firefox, location: locations[0]}),
      // Browser test, location 2, device 1
      getTestCase(browserTest, '7', {device: devices.chrome, location: locations[1]}),
      // Browser test, location 2, device 2
      getTestCase(browserTest, '8', {device: devices.firefox, location: locations[1]}),
      // Browser test, location 1, (timed out)
      getTestCase(browserTest, '9', {location: locations[0], timedOut: true}),
      // Browser test, location 1, (timed out)
      getTestCase(browserTest, '10', {location: locations[0], timedOut: true}),
      // Browser test, location 2, (timed out)
      getTestCase(browserTest, '11', {location: locations[1], timedOut: true}),
      // Browser test, location 2, (timed out)
      getTestCase(browserTest, '12', {location: locations[1], timedOut: true}),
    ]

    const caseNames = testCases.map((testCase) => testCase.$.name)

    const uniqueCaseNames = [...new Set(caseNames)]
    expect(uniqueCaseNames.length).toEqual(caseNames.length)

    expect(caseNames).toStrictEqual([
      // API tests.
      'Test name - id: aaa-aaa-aaa - location: aws:eu-central-1',
      'Test name - id: aaa-aaa-aaa - location: aws:eu-central-2',
      'Test name - id: aaa-aaa-aaa - location: aws:eu-central-1 - result id: 3 (not yet received)',
      'Test name - id: aaa-aaa-aaa - location: aws:eu-central-2 - result id: 4 (not yet received)',

      // Browser tests.
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-1 - device: chrome.laptop_large',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-1 - device: firefox.laptop_large',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-2 - device: chrome.laptop_large',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-2 - device: firefox.laptop_large',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-1 - device: chrome.laptop_large - result id: 9 (not yet received)',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-1 - device: chrome.laptop_large - result id: 10 (not yet received)',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-2 - device: chrome.laptop_large - result id: 11 (not yet received)',
      'Test name - id: bbb-bbb-bbb - location: aws:eu-central-2 - device: chrome.laptop_large - result id: 12 (not yet received)',
    ])
  })

  test('all columns are filled in the test report table', () => {
    const baseResult = getFailedBrowserResult()
    const result: Result = {
      ...baseResult,
      test: {...baseResult.test, suite: 'tests.json'},
    }

    reporter['resultEnd'](result, '', '')

    const testCase = reporter['json'].testsuites.testsuite[0].testcase[0]

    const name = 'Test name - id: abc-def-ghi - location: Location name - device: chrome.laptop_large'
    const failure = {
      $: {
        allowFailure: 'false',
        step: 'Assert',
        type: 'assertion',
      },
      _: 'Step timeout',
    }

    expect(testCase.$).toHaveProperty('classname', 'tests.json') // Suite
    expect(testCase.$).toHaveProperty('name', name) // Name
    expect(testCase.$).toHaveProperty('file', 'tests.json') // Filename
    expect(testCase.failure).toStrictEqual([failure]) // Status
    expect(testCase.$).toHaveProperty('time', 22) // Duration
  })

  test('the icon in the Status column is correct (blocking vs. non-blocking)', () => {
    // Mimics how GitLab chooses the Status icon.
    const getStatusIcon = (testCase: XMLTestCase) => {
      if (testCase.failure.length > 0) {
        return '❌'
      }
      if (testCase.error.length > 0) {
        return '❗️'
      }
      if (testCase.skipped.length > 0) {
        return '⏩'
      }

      return '✅'
    }

    reporter['testTrigger'](globalBrowserTestMock, '', ExecutionRule.SKIPPED, {})

    reporter['resultEnd']({...getFailedBrowserResult(), executionRule: ExecutionRule.BLOCKING} as Result, '', '')
    reporter['resultEnd']({...getFailedBrowserResult(), executionRule: ExecutionRule.NON_BLOCKING} as Result, '', '')
    reporter['resultEnd'](
      {...getBrowserResult('', globalBrowserTestMock), executionRule: ExecutionRule.BLOCKING},
      '',
      ''
    )

    const [testCaseSkipped, testCaseBlocking, testCaseNonBlocking, testCasePassed] = reporter[
      'json'
    ].testsuites.testsuite[0].testcase

    expect(getStatusIcon(testCaseSkipped)).toBe('⏩')
    expect(getStatusIcon(testCaseBlocking)).toBe('❌')
    expect(getStatusIcon(testCaseNonBlocking)).toBe('❗️')
    expect(getStatusIcon(testCasePassed)).toBe('✅')
  })

  test('api errors are nicely rendered', () => {
    const errorMessage = JSON.stringify([
      {
        actual: 1234,
        operator: 'lessThan',
        target: 1000,
        type: 'responseTime',
      },
    ])
    const failure = {code: 'INCORRECT_ASSERTION', message: errorMessage}

    const baseResult = getApiResult('1', globalApiTestMock)
    const result: Result = {
      ...baseResult,
      passed: false,
      result: {...baseResult.result, failure},
    }

    reporter['resultEnd'](result, '', '')

    const testCase = reporter['json'].testsuites.testsuite[0].testcase[0]
    expect(testCase.failure).toStrictEqual([
      {
        $: {step: 'Test name', type: 'INCORRECT_ASSERTION'},
        _: '- Assertion failed:\n    ▶ responseTime should be less than 1000. Actual: 1234',
      },
    ])
  })
})
