import fs from 'fs'

import type {CommandContext} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {Writable} from 'stream'

import c from 'chalk'
import upath from 'upath'
import {Builder} from 'xml2js'

import {
  ApiServerResult,
  Assertion,
  BaseResult,
  ExecutionRule,
  MultiStep,
  Reporter,
  Result,
  SelectiveRerunDecision,
  Step,
  Summary,
  Test,
  UserConfigOverride,
} from '../interfaces'
import {hasDefinedResult, isBaseResult, getPublicIdOrPlaceholder} from '../utils/internal'
import {
  getBatchUrl,
  getResultOutcome,
  getResultUrl,
  isDeviceIdSet,
  isResultSkippedBySelectiveRerun,
  PASSED_RESULT_OUTCOMES,
  pluralize,
  readableOperation,
} from '../utils/public'

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
      tests_not_authorized: number
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

const renderSelectiveRerun = (selectiveRerun?: SelectiveRerunDecision) => {
  if (!selectiveRerun) {
    return
  }

  const {decision, reason} = selectiveRerun

  if ('linked_result_id' in selectiveRerun) {
    return `decision:${decision},reason:${reason},linked_result_id:${selectiveRerun.linked_result_id}`
  }

  return `decision:${decision},reason:${reason}`
}

const getResultIdentification = (test: Test, id: string, location: string, device: string, resultTimedOut: string) => {
  if (location || device || resultTimedOut) {
    return `${test.name} - ${id} - ${location}${device}${resultTimedOut}`
  }

  return `${test.name} - ${id}`
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
          tests_not_authorized: 0,
          tests_not_found: 0,
          tests_passed: 0,
          tests_skipped: 0,
          tests_timed_out: 0,
        },
        testsuite: [],
      },
    }
  }

  public resultEnd(result: Result, baseUrl: string, batchId: string) {
    if (result.isNonFinal) {
      // To avoid any client code badly handling non-final results in JUnit reports,
      // we don't pollute those reports with intermediate results, as they are retried anyway.
      return
    }

    const suite = this.getSuiteByName(result.test.suite)
    const testCase = this.getTestCase(result, baseUrl, batchId)

    if (isResultSkippedBySelectiveRerun(result)) {
      return this.addTestCaseToSuite(suite, testCase)
    }

    // Errors and failures cannot co-exist: GitLab will always choose failures over errors.
    // The icon in the Status column will depend on this choice, and only the list of what is chosen will be displayed in the "System output".
    const errorOrFailure =
      result.executionRule === ExecutionRule.NON_BLOCKING
        ? testCase.error // ❗️
        : testCase.failure // ❌

    if (hasDefinedResult(result) && 'steps' in result.result) {
      if (result.test.type === 'browser') {
        // It's a browser test.
        const steps = result.result.steps as Step[]
        for (const step of steps) {
          const {allowedErrors, browserErrors, errors, warnings} = this.getBrowserTestErrors(step)
          testCase.allowed_error.push(...allowedErrors)
          testCase.browser_error.push(...browserErrors)
          errorOrFailure.push(...errors)
          testCase.warning.push(...warnings)
        }
      } else if (result.test.type === 'api') {
        // It's a multistep test.
        const steps = result.result.steps as MultiStep[]
        for (const step of steps) {
          const {allowedErrors, errors} = this.getMultiStepTestErrors(step)
          testCase.allowed_error.push(...allowedErrors)
          errorOrFailure.push(...errors)
        }
      }
    } else {
      // It's an api test.
      const {errors} = this.getApiTestErrors(result)
      errorOrFailure.push(...errors)
    }

    if (result.timedOut) {
      // Timeout errors are manually reported by the CLI at the test level.
      errorOrFailure.push({
        $: {type: 'timeout'},
        _: String(result.result?.failure?.message ?? 'The batch timed out before receiving the result.'),
      })
    } else if (errorOrFailure.length === 0 && hasDefinedResult(result) && result.result.failure) {
      // Fall back to any failure reported at the test level if nothing was reported at the step level.
      errorOrFailure.push({
        $: {type: 'test_failure'},
        _: `[${result.result.failure.code}] - ${result.result.failure.message}`,
      })
    }

    this.addTestCaseToSuite(suite, testCase)
  }

  public runEnd(summary: Summary, baseUrl: string) {
    Object.assign(this.json.testsuites.$, {
      tests_critical_error: summary.criticalErrors,
      tests_failed: summary.failed,
      tests_failed_non_blocking: summary.failedNonBlocking,
      tests_not_authorized: summary.testsNotAuthorized.size,
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
      fs.mkdirSync(upath.dirname(this.destination), {recursive: true})
      fs.writeFileSync(this.destination, xml, 'utf8')
      this.write(`\n✅ Created a jUnit report at ${c.bold.green(this.destination)}\n`)
    } catch (e) {
      this.write(`\n❌ Couldn't write the report to ${c.bold.green(this.destination)}:\n${e.toString()}\n`)
    }
  }

  // Handle skipped tests (`resultEnd()` is not called for them since they don't have a result).
  public testTrigger(
    test: Test,
    testId: string,
    executionRule: ExecutionRule,
    testOverrides: UserConfigOverride
  ): void {
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
    if ('allow_failure' in step) {
      allowfailures += step.allow_failure ? 1 : 0
    }
    if ('status' in step) {
      skipped += step.status === 'skipped' ? 1 : 0
    }

    return {
      steps_allowfailures: allowfailures,
      steps_count: 1,
      steps_errors: step.status === 'failed' ? 1 : 0,
      steps_failures: step.status === 'failed' ? 1 : 0,
      steps_skipped: skipped,
      steps_warnings: 0,
    }
  }

  private getApiTestErrors(result: BaseResult): {errors: XMLError[]} {
    const errors = []

    if (hasDefinedResult(result) && result.result.failure) {
      const xmlError = {
        $: {type: result.result.failure.code, step: result.test.name},
        _: renderApiError(result.result.failure.code, result.result.failure.message),
      }

      errors.push(xmlError)
    }

    return {errors}
  }

  private getBrowserStepStats(step: Step): TestCaseStats {
    const errors = step.browser_errors ? step.browser_errors.length : 0

    return {
      steps_allowfailures: step.allow_failure ? 1 : 0,
      steps_count: step.sub_test_step_details ? step.sub_test_step_details.length : 1,
      steps_errors: errors + (step.failure ? 1 : 0),
      steps_failures: step.failure ? 1 : 0,
      steps_skipped: step.status === 'skipped' ? 1 : 0,
      steps_warnings: step.warnings ? step.warnings.length : 0,
    }
  }

  private getBrowserTestErrors(step: Step): {
    allowedErrors: XMLError[]
    browserErrors: XMLError[]
    errors: XMLError[]
    warnings: XMLError[]
  } {
    const allowedErrors = []
    const browserErrors = []
    const errors = []
    const warnings = []

    if (step.browser_errors?.length) {
      browserErrors.push(
        ...step.browser_errors.map((e) => ({
          $: {type: e.type, name: e.name, step: step.description},
          _: e.description,
        }))
      )
    }

    if (step.failure) {
      const xmlError = {
        $: {type: 'assertion', step: step.description, allowFailure: `${step.allow_failure}`},
        _: step.failure.message,
      }

      if (step.allow_failure) {
        allowedErrors.push(xmlError)
      } else {
        errors.push(xmlError)
      }
    }

    if (step.warnings?.length) {
      warnings.push(
        ...step.warnings.map((w) => ({
          $: {type: w.type, step: step.description},
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
        $: {type: step.failure.code, step: step.name, allowFailure: `${step.allow_failure}`},
        _: renderApiError(step.failure.code, step.failure.message),
      }

      if (step.allow_failure) {
        allowedErrors.push(xmlError)
      } else {
        errors.push(xmlError)
      }
    }

    return {allowedErrors, errors}
  }

  private getSkippedTestCase(test: Test): XMLTestCase {
    const publicId = getPublicIdOrPlaceholder(test)
    const id = `id: ${publicId}`
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
          {$: {name: 'check_id', value: publicId}},
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          {$: {name: 'message', value: test.message}},
          ...('monitor_id' in test ? [{$: {name: 'monitor_id', value: test.monitor_id}}] : []),
          {$: {name: 'public_id', value: publicId}},
          ...('status' in test ? [{$: {name: 'status', value: test.status}}] : []),
          {$: {name: 'tags', value: (test.tags ?? []).join(',')}},
          {$: {name: 'type', value: test.type}},
        ].filter((prop) => prop.$.value !== undefined),
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

  private getTestCase(result: Result, baseUrl: string, batchId: string): XMLTestCase {
    const test = result.test
    const resultOutcome = getResultOutcome(result)
    const resultUrl = getResultUrl(baseUrl, test, result.resultId, batchId)

    const passed = PASSED_RESULT_OUTCOMES.includes(resultOutcome)

    const publicId = getPublicIdOrPlaceholder(test)
    const id = `id: ${publicId}`
    const location = isBaseResult(result) ? `location: ${result.location}` : ''
    const device = hasDefinedResult(result) && isDeviceIdSet(result) ? ` - device: ${result.device.id}` : ''
    const resultTimedOut = result.timedOut ? ` - result id: ${result.resultId} (not yet received)` : ''

    // This has to identify results, otherwise GitLab will only show the last result with the same name.
    const resultIdentification = getResultIdentification(test, id, location, device, resultTimedOut)

    return {
      $: {
        classname: test.suite,
        file: test.suite,
        name: resultIdentification,
        time: isBaseResult(result) ? result.duration / 1000 : 0,
        timestamp: hasDefinedResult(result)
          ? new Date(result.result.finished_at).toISOString()
          : new Date().toISOString(),
        ...this.getTestCaseStats(result),
      },
      allowed_error: [],
      browser_error: [],
      error: [],
      failure: [],
      properties: {
        property: [
          {$: {name: 'check_id', value: publicId}},
          ...(hasDefinedResult(result) && isDeviceIdSet(result)
            ? [
                {$: {name: 'device', value: result.device.id}},
                {$: {name: 'width', value: result.device.resolution.width}},
                {$: {name: 'height', value: result.device.resolution.height}},
              ]
            : []),
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          {$: {name: 'location', value: isBaseResult(result) && result.location}},
          {$: {name: 'message', value: test.message}},
          ...('monitor_id' in test ? [{$: {name: 'monitor_id', value: test.monitor_id}}] : []),
          {$: {name: 'passed', value: String(passed)}},
          {$: {name: 'public_id', value: publicId}},
          {$: {name: 'result_id', value: result.resultId}},
          {$: {name: 'initial_result_id', value: result.initialResultId}},
          {$: {name: 'result_url', value: resultUrl}},
          {$: {name: 'retries', value: isBaseResult(result) && result.retries}},
          {$: {name: 'max_retries', value: isBaseResult(result) && result.maxRetries}},
          {$: {name: 'selective_rerun', value: renderSelectiveRerun(result.selectiveRerun)}},
          {
            $: {
              name: 'start_url',
              value: hasDefinedResult(result) && 'startUrl' in result.result && result.result.startUrl,
            },
          },
          ...('status' in test ? [{$: {name: 'status', value: test.status}}] : []),
          {$: {name: 'tags', value: (test.tags ?? []).join(',')}},
          {$: {name: 'timeout', value: String(result.timedOut)}},
          {$: {name: 'type', value: test.type}},
        ].filter((prop) => prop.$.value !== undefined),
      },
      skipped: [],
      warning: [],
    }
  }

  private getTestCaseStats(result: Result): TestCaseStats {
    if (isResultSkippedBySelectiveRerun(result) || !hasDefinedResult(result)) {
      return getDefaultTestCaseStats()
    }

    let stepsStats: TestCaseStats[] = []
    if ('steps' in result.result) {
      if (result.test.type === 'browser') {
        // It's a browser test.
        const steps = result.result.steps as Step[]
        stepsStats = steps
          .map((step) => {
            if (!step.sub_test_step_details) {
              return [step]
            }

            return [step, ...step.sub_test_step_details]
          })
          .reduce((acc, val) => acc.concat(val), [])
          .map(this.getBrowserStepStats)
      } else if (result.test.type === 'api') {
        // It's an multistep API test
        const steps = result.result.steps as MultiStep[]
        stepsStats = steps.map(this.getApiStepStats)
      }
    } else {
      // It's an api test
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
