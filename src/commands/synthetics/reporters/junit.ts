import fs from 'fs'
import path from 'path'

import type {Writable} from 'stream'

import c from 'chalk'
import {Builder} from 'xml2js'

import type {CommandContext} from '../../../helpers/interfaces'

import {
  ApiServerResult,
  Assertion,
  ExecutionRule,
  MultiStep,
  Reporter,
  Result,
  Step,
  Summary,
  SyntheticsOrgSettings,
  Test,
  UserConfigOverride,
} from '../interfaces'
import {
  getBatchUrl,
  getResultDuration,
  getResultOutcome,
  getResultUrl,
  isDeviceIdSet,
  pluralize,
  readableOperation,
  ResultOutcome,
} from '../utils'

interface SuiteStats {
  errors: number
  failures: number
  skipped: number
  tests: number
}

interface TestCaseStats {
  steps_allowfailures: number
  steps_count: number
  steps_errors: number
  steps_failures: number
  steps_skipped: number
  steps_warnings: number
}

interface XMLSuiteProperties extends SuiteStats {
  name: string
}

interface XMLSuite {
  $: XMLSuiteProperties
  testcase: XMLTestCase[]
}

interface XMLTestCaseProperties extends TestCaseStats {
  // Those properties are shown in the GitLab Pipeline's test report tab.
  // https://gitlab.com/gitlab-org/gitlab/-/blob/1847b49a8ab5205f756611ec3dfc98f405b662ac/lib/gitlab/ci/parsers/test/junit.rb#L66-94
  classname: string | undefined // Shown in the Suite column.
  file: string | undefined // Shown as a hyperlink to the test config file: must be a file path.

  name: string
  time: number | undefined
  timestamp: string
}

export interface XMLTestCase {
  $: XMLTestCaseProperties
  // These are singular for a better display in the XML format of the report.
  allowed_error: XMLError[]
  browser_error: XMLError[]
  // Displays ❗️ in the Status column of the GitLab Pipeline's test report tab.
  // This is used when a test fails but is non-blocking i.e. does not block the CI/CD pipeline.
  error: XMLError[]
  // Displays ❌ in the Status column of the GitLab Pipeline's test report tab.
  // This is used when a test fails and is blocking.
  failure: XMLError[]
  properties: {
    property: {$: {name: string; value: any}}[]
  }
  // Displays ⏩ in the Status column of the GitLab Pipeline's test report tab.
  // This is used when a test is skipped.
  skipped: string[]
  warning: XMLError[]
}

export interface XMLJSON {
  testsuites: {
    $: {
      // All these attributes are non-standard to a jUnit report.
      // https://github.com/windyroad/JUnit-Schema/blob/master/JUnit.xsd
      batch_id: string
      batch_url: string
      name: string
      tests_critical_error: number
      tests_failed: number
      tests_failed_non_blocking: number
      tests_not_found: number
      tests_passed: number
      tests_skipped: number
      tests_timed_out: number
    }
    testsuite: XMLSuite[]
  }
}

interface XMLError {
  $: {[key: string]: string; type: string}
  _: string
}

export interface Args {
  context: CommandContext
  jUnitReport?: string
  runName?: string
}

const renderApiError = (errorCode: string, errorMessage: string) => {
  if (errorCode === 'INCORRECT_ASSERTION') {
    try {
      const assertionsErrors: Assertion[] = JSON.parse(errorMessage)
      const output = [`- ${pluralize('Assertion', assertionsErrors.length)} failed:`]
      output.push(
        ...assertionsErrors.map((error) => {
          const expected = error.target
          const actual = error.actual

          return `▶ ${error.type} ${readableOperation[error.operator]} ${expected}. Actual: ${actual}`
        })
      )

      return output.join('\n    ')
    } catch (e) {
      // JSON parsing failed, do nothing to return the raw error
    }
  }

  return `  [${errorCode}] - ${errorMessage}`
}

export const getDefaultTestCaseStats = (): TestCaseStats => ({
  steps_allowfailures: 0,
  steps_count: 0,
  steps_errors: 0,
  steps_failures: 0,
  steps_skipped: 0,
  steps_warnings: 0,
})

export const getDefaultSuiteStats = (): SuiteStats => ({
  errors: 0,
  failures: 0,
  skipped: 0,
  tests: 0,
})

export class JUnitReporter implements Reporter {
  private builder: Builder
  private destination: string
  private json: XMLJSON
  private write: Writable['write']

  constructor({context, jUnitReport, runName}: Args) {
    this.write = context.stdout.write.bind(context.stdout)
    this.destination = jUnitReport!
    if (!this.destination.endsWith('.xml')) {
      this.destination += '.xml'
    }
    this.builder = new Builder()
    this.json = {
      testsuites: {
        $: {
          batch_id: '',
          batch_url: '',
          name: runName || 'Undefined run',
          tests_critical_error: 0,
          tests_failed: 0,
          tests_failed_non_blocking: 0,
          tests_not_found: 0,
          tests_passed: 0,
          tests_skipped: 0,
          tests_timed_out: 0,
        },
        testsuite: [],
      },
    }
  }

  public resultEnd(result: Result, baseUrl: string) {
    const suite = this.getSuiteByName(result.test.suite)
    const testCase = this.getTestCase(result, baseUrl)

    // Errors and failures cannot co-exist: GitLab will always choose failures over errors.
    // The icon in the Status column will depend on this choice, and only the list of what is chosen will be displayed in the "System output".
    const errorOrFailure =
      result.executionRule === ExecutionRule.NON_BLOCKING
        ? testCase.error // ❗️
        : testCase.failure // ❌

    // Timeout errors are only reported at the top level.
    if (result.timedOut) {
      errorOrFailure.push({
        $: {type: 'timeout'},
        _: String(result.result.failure?.message),
      })
    }
    if ('stepDetails' in result.result) {
      // It's a browser test.
      for (const stepDetail of result.result.stepDetails) {
        const {allowedErrors, browserErrors, errors, warnings} = this.getBrowserTestErrors(stepDetail)
        testCase.allowed_error.push(...allowedErrors)
        testCase.browser_error.push(...browserErrors)
        errorOrFailure.push(...errors)
        testCase.warning.push(...warnings)
      }
    } else if ('steps' in result.result) {
      // It's a multistep test.
      for (const step of result.result.steps) {
        const {allowedErrors, errors} = this.getMultiStepTestErrors(step)
        testCase.allowed_error.push(...allowedErrors)
        errorOrFailure.push(...errors)
      }
    } else {
      // It's an api test.
      const {errors} = this.getApiTestErrors(result)
      errorOrFailure.push(...errors)
    }

    this.addTestCaseToSuite(suite, testCase)
  }

  public runEnd(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings) {
    Object.assign(this.json.testsuites.$, {
      tests_critical_error: summary.criticalErrors,
      tests_failed: summary.failed,
      tests_failed_non_blocking: summary.failedNonBlocking,
      tests_not_found: summary.testsNotFound.size,
      tests_passed: summary.passed,
      tests_skipped: summary.skipped,
      tests_timed_out: summary.timedOut,
    })

    this.json.testsuites.$.batch_id = summary.batchId
    this.json.testsuites.$.batch_url = getBatchUrl(baseUrl, summary.batchId)

    // Write the file
    try {
      const xml = this.builder.buildObject(this.json)
      fs.mkdirSync(path.dirname(this.destination), {recursive: true})
      fs.writeFileSync(this.destination, xml, 'utf8')
      this.write(`✅ Created a jUnit report at ${c.bold.green(this.destination)}\n`)
    } catch (e) {
      this.write(`❌ Couldn't write the report to ${c.bold.green(this.destination)}:\n${e.toString()}\n`)
    }
  }

  // Handle skipped tests (`resultEnd()` is not called for them since they don't have a result).
  public testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride): void {
    if (executionRule !== ExecutionRule.SKIPPED) {
      return
    }

    const suite = this.getSuiteByName(test.suite)
    const testCase = this.getSkippedTestCase(test)

    testCase.skipped.push('This test was skipped because of its execution rule configuration in Datadog')

    this.addTestCaseToSuite(suite, testCase)
  }

  private addTestCaseToSuite(suite: XMLSuite, testCase: XMLTestCase): void {
    suite.$ = {
      errors: suite.$.errors + testCase.error.length,
      failures: suite.$.failures + testCase.failure.length,
      name: suite.$.name,
      skipped: suite.$.skipped + testCase.skipped.length,
      tests: suite.$.tests + 1,
    }

    suite.testcase.push(testCase)
  }

  private getApiStepStats(step: MultiStep | ApiServerResult): TestCaseStats {
    // TODO use more granular result based on step.assertionResults
    let allowfailures = 0
    let skipped = 0
    if ('allowFailure' in step) {
      allowfailures += step.allowFailure ? 1 : 0
    }
    if ('skipped' in step) {
      skipped += step.skipped ? 1 : 0
    }

    return {
      steps_allowfailures: allowfailures,
      steps_count: 1,
      steps_errors: step.passed ? 0 : 1,
      steps_failures: step.passed ? 0 : 1,
      steps_skipped: skipped,
      steps_warnings: 0,
    }
  }

  private getApiTestErrors(result: Result): {errors: XMLError[]} {
    const errors = []

    if (result.result.failure) {
      const xmlError = {
        $: {type: result.result.failure.code, step: result.test.name},
        _: renderApiError(result.result.failure.code, result.result.failure.message),
      }

      errors.push(xmlError)
    }

    return {errors}
  }

  private getBrowserStepStats(step: Step): TestCaseStats {
    const errors = step.browserErrors ? step.browserErrors.length : 0

    return {
      steps_allowfailures: step.allowFailure ? 1 : 0,
      steps_count: step.subTestStepDetails ? step.subTestStepDetails.length : 1,
      steps_errors: errors + (step.error ? 1 : 0),
      steps_failures: step.error ? 1 : 0,
      steps_skipped: step.skipped ? 1 : 0,
      steps_warnings: step.warnings ? step.warnings.length : 0,
    }
  }

  private getBrowserTestErrors(
    stepDetail: Step
  ): {
    allowedErrors: XMLError[]
    browserErrors: XMLError[]
    errors: XMLError[]
    warnings: XMLError[]
  } {
    const allowedErrors = []
    const browserErrors = []
    const errors = []
    const warnings = []

    if (stepDetail.browserErrors?.length) {
      browserErrors.push(
        ...stepDetail.browserErrors.map((e) => ({
          $: {type: e.type, name: e.name, step: stepDetail.description},
          _: e.description,
        }))
      )
    }

    if (stepDetail.error) {
      const xmlError = {
        $: {type: 'assertion', step: stepDetail.description, allowFailure: `${stepDetail.allowFailure}`},
        _: stepDetail.error,
      }

      if (stepDetail.allowFailure) {
        allowedErrors.push(xmlError)
      } else {
        errors.push(xmlError)
      }
    }

    if (stepDetail.warnings?.length) {
      warnings.push(
        ...stepDetail.warnings.map((w) => ({
          $: {type: w.type, step: stepDetail.description},
          _: w.message,
        }))
      )
    }

    return {allowedErrors, browserErrors, errors, warnings}
  }

  private getMultiStepTestErrors(step: MultiStep): {allowedErrors: XMLError[]; errors: XMLError[]} {
    const allowedErrors = []
    const errors = []

    if (step.failure) {
      const xmlError = {
        $: {type: step.failure.code, step: step.name, allowFailure: `${step.allowFailure}`},
        _: renderApiError(step.failure.code, step.failure.message),
      }

      if (step.allowFailure) {
        allowedErrors.push(xmlError)
      } else {
        errors.push(xmlError)
      }
    }

    return {allowedErrors, errors}
  }

  private getSkippedTestCase(test: Test): XMLTestCase {
    const id = `id: ${test.public_id}`
    const resultIdentification = `${test.name} - ${id} (skipped)`

    return {
      $: {
        classname: test.suite,
        file: test.suite,
        name: resultIdentification,
        time: 0,
        timestamp: new Date().toISOString(),
        ...getDefaultTestCaseStats(),
      },
      allowed_error: [],
      browser_error: [],
      error: [],
      failure: [],
      properties: {
        property: [
          {$: {name: 'check_id', value: test.public_id}},
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          {$: {name: 'message', value: test.message}},
          {$: {name: 'monitor_id', value: test.monitor_id}},
          {$: {name: 'public_id', value: test.public_id}},
          {$: {name: 'status', value: test.status}},
          {$: {name: 'tags', value: test.tags.join(',')}},
          {$: {name: 'type', value: test.type}},
        ].filter((prop) => prop.$.value),
      },
      skipped: [],
      warning: [],
    }
  }

  private getSuiteByName(suiteName = 'Undefined suite'): XMLSuite {
    const existingSuite = this.json.testsuites.testsuite.find((element) => element.$.name === suiteName)

    if (!existingSuite) {
      const suite: XMLSuite = {
        $: {name: suiteName, ...getDefaultSuiteStats()},
        testcase: [],
      }

      this.json.testsuites.testsuite.push(suite)

      return suite
    }

    return existingSuite
  }

  private getTestCase(result: Result, baseUrl: string): XMLTestCase {
    const test = result.test
    const resultOutcome = getResultOutcome(result)
    const resultUrl = getResultUrl(baseUrl, test, result.resultId)
    const passed = [ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)

    const id = `id: ${test.public_id}`
    const location = `location: ${result.location}`
    const device = isDeviceIdSet(result.result) ? ` - device: ${result.result.device.id}` : ''
    const resultTimedOut = result.timedOut ? ` - result id: ${result.resultId} (not yet received)` : ''

    // This has to identify results, otherwise GitLab will only show the last result with the same name.
    const resultIdentification = `${test.name} - ${id} - ${location}${device}${resultTimedOut}`

    return {
      $: {
        classname: test.suite,
        file: test.suite,
        name: resultIdentification,
        time: getResultDuration(result.result) / 1000,
        timestamp: new Date(result.timestamp).toISOString(),
        ...this.getTestCaseStats(result),
      },
      allowed_error: [],
      browser_error: [],
      error: [],
      failure: [],
      properties: {
        property: [
          {$: {name: 'check_id', value: test.public_id}},
          ...(isDeviceIdSet(result.result)
            ? [
                {$: {name: 'device', value: result.result.device.id}},
                {$: {name: 'width', value: result.result.device.width}},
                {$: {name: 'height', value: result.result.device.height}},
              ]
            : []),
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          {$: {name: 'location', value: result.location}},
          {$: {name: 'message', value: test.message}},
          {$: {name: 'monitor_id', value: test.monitor_id}},
          {$: {name: 'passed', value: `${passed}`}},
          {$: {name: 'public_id', value: test.public_id}},
          {$: {name: 'result_id', value: result.resultId}},
          {$: {name: 'result_url', value: resultUrl}},
          ...('startUrl' in result.result ? [{$: {name: 'start_url', value: result.result.startUrl}}] : []),
          {$: {name: 'status', value: test.status}},
          {$: {name: 'tags', value: test.tags.join(',')}},
          {$: {name: 'timeout', value: `${result.timedOut}`}},
          {$: {name: 'type', value: test.type}},
        ].filter((prop) => prop.$.value),
      },
      skipped: [],
      warning: [],
    }
  }

  private getTestCaseStats(result: Result): TestCaseStats {
    let stepsStats: TestCaseStats[] = []
    if ('stepDetails' in result.result) {
      // It's a browser test.
      stepsStats = result.result.stepDetails
        .map((step) => {
          if (!step.subTestStepDetails) {
            return [step]
          }

          return [step, ...step.subTestStepDetails]
        })
        .reduce((acc, val) => acc.concat(val), [])
        .map(this.getBrowserStepStats)
    } else if ('steps' in result.result) {
      // It's an multistep API test
      stepsStats = result.result.steps.map(this.getApiStepStats)
    } else {
      stepsStats = [this.getApiStepStats(result.result)]
    }

    const stats = getDefaultTestCaseStats()

    for (const stepStats of stepsStats) {
      stats.steps_count += stepStats.steps_count
      stats.steps_errors += stepStats.steps_errors
      stats.steps_failures += stepStats.steps_failures
      stats.steps_skipped += stepStats.steps_skipped
      stats.steps_allowfailures += stepStats.steps_allowfailures
      stats.steps_warnings += stepStats.steps_warnings
    }

    return stats
  }
}
